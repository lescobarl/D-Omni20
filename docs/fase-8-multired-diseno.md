# Diseño de Extensión Multired / SMS — Fase 8 (opcional)

**Proyecto:** OmniBotIA Studio (D-Omni2.0)
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** OPCIONAL / DIFERIDO ✅ (no bloquea el "traído al core")

---

## §1 Propósito (Fase 8)

Documentar el **punto de extensión** para añadir canales de mensajería adicionales
(Instagram, Messenger, webchat) y **SMS (Twilio, opcional)** al bot, sin modificar
el núcleo.

> Definición del plan (§15.3, Bloque F — Fase 8): *"Adaptadores `IChannelAdapter`
> adicionales: Instagram, Messenger, webchat; registro en factory de canales."*
> Y (§7, línea 253): *"Twilio SMS (opcional) / multired social (futuro): mismos
> adaptadores `IChannelAdapter`; la extensión no cambia el núcleo."*

**Estado:** OPCIONAL/FUTURO. No forma parte del objetivo "traído al core" (Fase C)
ni de la validación productiva final. Este documento fija el contrato y el
procedimiento para cuando se decida implementar.

---

## §2 Contrato de extensión (ya existente)

El puerto que todo canal debe implementar está definido en
[`IChannelAdapter`](../backend/app/bot/interfaces.py:106):

| Miembro | Firma | Responsabilidad |
|---------|-------|-----------------|
| `kind` | `-> str` | Tipo de canal (`whatsapp`, `sms`, `instagram`, …) |
| `parse_inbound` | `(*, payload: Any) -> InboundMessage` | Normaliza el payload crudo del canal a `InboundMessage` |
| `send` | `(*, reply: BotResponse, message: InboundMessage) -> bool` | Envía la respuesta al contacto |

La fábrica tenant-aware [`ChannelSenderFactory`](../backend/app/bot/channels/factory.py:40)
resuelve el adaptador concreto por `channel_id` leyendo `tenant_channels` (secretos
cifrados en reposo vía `TokenCipher`).

### 2.1 Punto de registro (único cambio de fábrica)

Hoy la fábrica **solo soporta WhatsApp** y rechaza cualquier otro tipo con
fail-closed:

- Guard actual: `if channel.channel_type != self._WHATSAPP: return None` en
  [`factory.py`](../backend/app/bot/channels/factory.py:92), con log
  `bot.factory.unsupported_channel`.

Para añadir un canal, este guard se sustituye por un **registro de adaptadores**
(`dict[str, Callable[[TenantChannel], IChannelAdapter]]`) — sin hardcode en los
endpoints, siguiendo la regla DI.

---

## §3 Procedimiento para añadir un canal

1. **Crear el adaptador** en `app/bot/channels/` (ej. `instagram_adapter.py`):
   - Implementar `IChannelAdapter` (`kind`, `parse_inbound`, `send`).
   - Inyectar su sender/credenciales por constructor (nunca `new` en la capa HTTP).
   - `parse_inbound` normaliza el payload a `InboundMessage` (misma estructura
     que WhatsApp: `tenant_id`, `channel_id`, `channel_type`, `external_contact_id`,
     `message_id`, `text`, `timestamp`).
2. **Registrar en la fábrica**: añadir el tipo al mapa de registro y las
   credenciales requeridas en `tenant_channels` (nueva columna/tipo vía migración
   Alembic; no duplicar secretos).
3. **Endpoint de webhook del canal** (si el canal usa webhook): un
   `GET`/`POST` análogo a
   [`verify_whatsapp_webhook()`](../backend/app/api/v1/bot.py:88) /
   [`receive_whatsapp_webhook()`](../backend/app/api/v1/bot.py:149), reutilizando
   `enqueue_inbound` y la verificación de firma fail-closed.
4. **Frontend**: registrar el tipo de canal en la sección Bots/Canales
   (`VITE_FEATURE_BOTS`) para configuración por empresa.
5. **Tests**: unitarios del adaptador (parse/send), integración del webhook y
   del registro en la fábrica (patrón de
   [`test_api_bot.py`](../backend/tests/test_api_bot.py:155) y
   [`test_bot_queue.py`](../backend/tests/test_bot_queue.py:202)).

---

## §4 Diseño de referencia por canal

| Canal | Adaptador | Credenciales en `tenant_channels` | Webhook entrante |
|-------|-----------|-----------------------------------|------------------|
| **SMS (Twilio, opcional)** | `SmsChannelAdapter` (`kind="sms"`) | `account_sid`, `auth_token` (cifrados) | `POST /bot/channels/sms/webhook` — validar firma `X-Twilio-Signature` |
| **Instagram** | `InstagramChannelAdapter` (`kind="instagram"`) | token de página / API Graph | `POST /bot/channels/instagram/webhook` — firma `X-Hub-Signature-256` |
| **Messenger** | `MessengerChannelAdapter` (`kind="messenger"`) | token de página | `POST /bot/channels/messenger/webhook` — firma `X-Hub-Signature-256` |
| **Webchat** | `WebchatChannelAdapter` (`kind="webchat"`) | clave de widget por tenant | API propia (sin firma externa; auth por tenant) |

Todos comparten `enqueue_inbound` (cola D3), `ConversationService`, la cuota de
tokens y la privacidad — **el núcleo no cambia**.

---

## §5 Cumplimiento (reglas CLAUDE)

- **DI / sin `new`**: los adaptadores se construyen en la fábrica (composition
  root) con credenciales inyectadas y cifradas en reposo.
- **Fail-closed**: cada canal verifica su firma antes de aceptar; tipo no
  registrado → `None`/403, nunca aceptación implícita.
- **No rompe WhatsApp**: el registro es aditivo; el guard actual se sustituye por
  un mapa, manteniendo el comportamiento fail-closed de
  `bot.factory.unsupported_channel`.
- **Sin hardcode**: tipos y credenciales vienen de `tenant_channels` +
  `Settings`; los webhooks nuevos reutilizan la verificación existente.
- **Validación**: cada canal añadido exige tests unitarios/integración y su
  sección en la validación por fase (regla CLAUDE: sin entregas sin validación).

---

## §6 Estado del backlog

| Fase | Estado |
|------|--------|
| Fases 0–7, 9 | COMPLETADO ✅ |
| Fase C (cutover) | LISTO PARA EJECUTAR ✅ |
| Fase O (monitoreo) | DOCUMENTADO ✅ |
| **Fase 8 (multired/SMS)** | **OPCIONAL / DIFERIDO ✅** — diseño listo, implementación no bloquea |
| Validación productiva final | Pendiente (tras C y O) |

---

# PARTE II — C.3 Portal Unificado Multired (Portal del Cliente)

**Proyecto:** OmniBotIA Studio (D-Omni2.0)
**Fecha:** 2026-08-31
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** IMPLEMENTADO ✅ (serving + API + personalización config-driven) · diseño C.3 documentado aquí

> Este documento cubre los **§1–§6 (Fase 8: adaptadores de canal multired/SMS)** más el
> **Portal del Cliente (C-3)**. El C-3 es la pieza de autoservicio del comprador final:
> una página pública por tenant (`{origin}/portal`) con páginas configurables
> (misión/visión, acerca, servicios, contacto…) y un área privada con login por email
> donde el cliente consulta sus pagos, solicitudes, cotizaciones, citas y ejerce sus
> derechos ARCO. **Multired**: un solo portal implementado que cada cliente publica en
> su propio subdominio `{slug}.clientes.omni2.app` o dominio personalizado, 100 %
> configurado desde el configurador de Omni2.0 (control plane) — sin hardcode.

---

## §7 C.3 — Propósito y alcance

El Portal del Cliente (C-3) resuelve dos necesidades del escenario comercial (§9.1):

1. **Área privada de autoservicio**: el comprador final se autentica con su correo
   (token firmado HMAC-SHA256) y consulta el estado de su pedido/oportunidad
   (pagos, leads/cotizaciones y citas) y ejerce sus derechos ARCO de la LFPDPPP
   (exportar o borrar sus datos).
2. **Sitio público configurable**: páginas del portal (p. ej. "Misión y visión",
   "Acerca de", "Servicios", "Contacto", "Ubicación") editables desde el
   configurador de Omni2.0 y servidas bajo el mismo subdominio/dominio del cliente.

**Regla rectora (CLAUDE — sin hardcode):** toda la personalización proviene de
datos del tenant (control plane §4.1): la paleta de [`tenant_appearance`](../backend/app/schemas/tenant_config.py:34)
y las páginas de `content_items` con `kind="portal"` ([`ContentItemCreate`](../backend/app/schemas/tenant_config.py:130)).
Ningún contenido del cliente está embebido en el código.

---

## §8 C.3 — Arquitectura de serving

### 8.1 Ruta pública raíz

El portal se sirve desde **la raíz** (fuera del prefijo `api_v1`) en la URL
determinista `{origin}/portal` — p. ej. `https://escobar.clientes.omni2.app/portal` —
definido en [`serve_portal()`](../backend/app/api/portal_serve.py:310).

- El tenant se resuelve **SIEMPRE por la cabecera `Host`** contra `pseo_hosts` vía
  [`get_pseo_tenant_by_host()`](../backend/app/api/deps.py:612), igual que el serving
  PSEO/CDN. Host ausente/desconocido/inactivo → **404 fail-closed**, sin leak entre
  tenants.
- El endpoint devuelve una página HTML autocontenida que:
  1. Declara el contenedor `[data-omni-portal]` que renderiza `portal.js`.
  2. Inyecta `#omnibotia-config` (JSON con `tenantId`, `apiBaseUrl`, `appearance` y
     `pages`) usando `_script_safe_json` ([`portal_serve.py`](../backend/app/api/portal_serve.py:220)),
     el patrón anti-`</script>` del CDN.
  3. Carga `{origin}/static/portal.js` con `defer` ([`portal_serve.py`](../backend/app/api/portal_serve.py:352)).

El widget cliente ([`portal.js`](../backend/static/portal.js:319)) renderiza la
navegación multipágina (`renderNav`) y el área privada login/resumen/ARCO (`init`).

### 8.2 Personalización config-driven (sin hardcode)

| Origen | Dónde se define | Cómo se consume |
|--------|-----------------|-----------------|
| **Apariencia** (paleta, logo, tipografía) | [`TenantAppearanceUpsert`](../backend/app/schemas/tenant_config.py:34) vía `PUT /api/v1/tenant/appearance` | `_appearance_css` → variables CSS `--omni-*` ([`portal_serve.py`](../backend/app/api/portal_serve.py:253)); también viaja en `#omnibotia-config` |
| **Páginas del portal** | `content_items` con `kind="portal"` vía `POST /api/v1/content`; `title` = pestaña, `content` = cuerpo, `tags[0]` = slug | [`_portal_pages()`](../backend/app/api/portal_serve.py:281) |
| **Fallback genérico** | `_DEFAULT_PORTAL_PAGES` ([`portal_serve.py`](../backend/app/api/portal_serve.py:55)) — 3 páginas neutras | Solo si el tenant no configuró ninguna página; **nunca** es contenido del cliente |

El `ContentKind` admite `"portal"` ([`tenant_config.py`](../backend/app/schemas/tenant_config.py:29)),
lo que habilita el endpoint de contenido para configurar páginas del portal con el
mismo API/validación que el resto del contenido del bot.

### 8.3 API del Portal (`/api/v1/portal/*`)

Área privada con `Authorization: Bearer <token>` (token firmado con
`portal_token_secret`). El tenant se resuelve por `X-Tenant-Id`
([`get_current_tenant()`](../backend/app/api/deps.py:560)) y el token debe pertenecer
a ese mismo tenant; cualquier fallo es 403 fail-closed
([`get_current_portal_client()`](../backend/app/api/v1/portal.py:71)). Reutiliza
`IWorkflowService` (métodos `*_by_email`) e `IPrivacyService` (mismos flujos que
`/bot/privacy/*`) — regla CLAUDE: sin duplicación.

| Endpoint | Ruta | Propósito |
|----------|------|-----------|
| Login | [`POST /login`](../backend/app/api/v1/portal.py:135) | Emite token si el correo tiene registros en el tenant (403 sin distinguir existencia) |
| Resumen | [`GET /summary`](../backend/app/api/v1/portal.py:167) | Pagos + leads + cotizaciones + citas + oportunidades CRM abiertas y próximos pasos |
| Pagos | [`GET /payments`](../backend/app/api/v1/portal.py:235) / [`GET /payments/{id}`](../backend/app/api/v1/portal.py:250) | Historial de pagos del cliente (404 si es ajeno) |
| Solicitudes | [`GET /leads`](../backend/app/api/v1/portal.py:272) | Leads del cliente autenticado |
| Cotizaciones | [`GET /quotes`](../backend/app/api/v1/portal.py:287) | Cotizaciones del cliente autenticado |
| Citas | [`GET /appointments`](../backend/app/api/v1/portal.py:302) | Citas del cliente autenticado |
| Privacidad | [`GET /privacy/export`](../backend/app/api/v1/portal.py:317) / [`DELETE /privacy/data`](../backend/app/api/v1/portal.py:330) | Derechos ARCO: portabilidad y cancelación (LFPDPPP) |

---

## §9 C.3 — Subdominios automáticos `{slug}.clientes.omni2.app`

### 9.1 Estrategia (decisión de producto confirmada)

Los clientes **sin dominio propio** publican su landing + portal en un subdominio
dinámico derivado de su slug:

```
{slug}.clientes.omni2.app        →  escobar.clientes.omni2.app
```

- El dominio base se configura en `client_subdomain_base`
  ([`settings.py`](../backend/app/config/settings.py:105), por defecto
  `"clientes.omni2.app"`; vacío = subdominios desactivados).
- Se sirve con **Wildcard DNS** (CNAME/A `*.clientes.omni2.app` → nuestro servidor);
  el navegador envía el subdominio en la cabecera `Host` y el backend lo resuelve al
  tenant exactamente igual que un dominio personalizado.
- `cdn_base_url` ([`settings.py`](../backend/app/config/settings.py:98)) deriva el
  origen desde el que se sirven los assets estáticos (`/static/portal.js`) y la API
  (`apiBaseUrl`), y la CORS se abre a `*.clientes.omni2.app`.

### 9.2 Resolución actual y gap de auto-provisioning

**Hoy (implementado):** [`get_pseo_tenant_by_host()`](../backend/app/api/deps.py:612)
hace *match exacto* del `Host` contra la tabla `pseo_hosts`. Por tanto, un subdominio
`{slug}.clientes.omni2.app` debe estar **registrado explícitamente** como fila de
`pseo_hosts` (mismo flujo que un dominio personalizado: `PseoHostService.request_domain`
→ verificación → activo). El dev tenant se siembra así en
[`_seed_dev_tenant()`](../backend/app/main.py:42) (host derivado del netloc de
`cdn_base_url`).

**Gap (pendiente, backlog C-3):** el *auto-provisioning* del subdominio al dar de alta
un tenant: registrar automáticamente `{slug}.clientes.omni2.app` en `pseo_hosts`
(estado `active`, verificación implícita por ser wildcard del propio dominio) en el
mismo punto donde se crea el tenant, sin intervención manual y sin hardcode del slug
(derivado del `slug` del tenant + `client_subdomain_base`).

### 9.3 CORS

- `cors_origins` admite patrón wildcard para `*.clientes.omni2.app`; el widget
  `portal.js` se sirve desde el mismo origen derivado de `cdn_base_url`, por lo que
  las peticiones `apiBaseUrl` al backend son same-origin en producción (o desde el
  origen CDN en dev) y la CORS permite el acceso a `/api/v1/portal/*` desde los
  subdominios del cliente.

---

## §10 C.3 — Configuración de referencia (Inmobiliaria Escobar)

Configurada vía el **configurador de Omni2.0** (control plane), nunca hardcodeada,
por [`seed_escobar_portal.py`](../backend/scripts/seed_escobar_portal.py:1)
(idempotente, CLI):

- **Apariencia** (`PUT /api/v1/tenant/appearance`):
  `primary #1D4ED8`, `accent #0E7490`, `surface #FFFFFF`, `text #0F172A`,
  `brand_badge #1D4ED8`, `font_family "Inter", system-ui, sans-serif`.
- **Páginas del portal** (`POST /api/v1/content`, `kind="portal"`) — **5 páginas**
  (requisito: ≥ 3, incluyendo "Misión y visión" y "Acerca de"):

| Página (title) | slug (tags[0]) | Contenido |
|----------------|----------------|-----------|
| Misión y visión | `mision-vision` | Misión/visión de la inmobiliaria |
| Acerca de | `acerca` | Casa vista al lago Tequesquitengo, av. del Lago 12 |
| Servicios | `servicios` | Asesoría, financiamiento, posventa |
| Contacto | `contacto` | Teléfono +52 777 123 4567 |
| Ubicación | `ubicacion` | Ubicación y cómo llegar |

**Verificado (2026-08-31):** `GET /portal` con `Host: localhost:8000` → 200, paleta
Escobar en `--omni-*`, `/static/portal.js`, `#omnibotia-config` presente, los 5 slugs
y sin artefactos de plantilla (`{{`, `{placeholder}`).

---

## §11 C.3 — Cumplimiento (reglas CLAUDE)

- **DI / sin `new`**: el serving inyecta repositorios por `Depends`
  (`ITenantAppearanceRepository`, `IContentItemRepository`) y el tenant se resuelve
  por `Host` en `deps.py` — sin composición en los endpoints.
- **Sin hardcode**: apariencia desde `tenant_appearance` y páginas desde
  `content_items kind="portal"`; `_DEFAULT_PORTAL_PAGES` es fallback genérico neutro,
  nunca contenido del cliente. El slug se deriva de `tags[0]` (o `id` como último
  recurso), nunca embebido.
- **Fail-closed**: `get_pseo_tenant_by_host` devuelve 404 para Host ausente/no
  registrado/inactivo; el portal (`/portal/*`) y la API exigen token del mismo tenant
  (403 sin revelar existencia de datos ajenos); login 403 sin distinguir si el correo
  existe.
- **Privacidad (ARCO/LFPDPPP)**: exportación y borrado reutilizan `IPrivacyService`
  (mismos flujos auditados que `/bot/privacy/*`).
- **Validación**: la inyección `#omnibotia-config` usa `_script_safe_json`
  (anti-`</script>`); el color se valida con `COLOR_PATTERN` en el esquema; el
  `ContentItemCreate` usa `extra="forbid"`.

## §12 C.3 — Validación y estado

| Ítem | Estado |
|------|--------|
| Serving `GET /portal` (Host-resuelto, 404 fail-closed) | ✅ [`test_pseo.py`](../backend/tests/test_pseo.py:444) (`test_static_portal_js_served_200`) + verificación e2e |
| Config `#omnibotia-config` + `portal.js` | ✅ verificado `GET /portal` (Host `localhost:8000`) |
| Apariencia → CSS variables | ✅ verificado `--omni-primary: #1D4ED8` / `--omni-accent: #0E7490` |
| Páginas `kind="portal"` → pestañas multipágina | ✅ 5 páginas sembradas + verificadas (≥ 3, incl. misión/visión y acerca) |
| API `/api/v1/portal/*` (login/summary/pagos/ARCO) | ✅ suite `test_api_portal.py` + E2E `e2e_escobar_scenario.py` |
| **Auto-subdominio `{slug}.clientes.omni2.app` (auto-provisioning)** | ✅ [`client_subdomain.py`](../backend/app/services/client_subdomain.py) registra `{slug}.{client_subdomain_base}` en `pseo_hosts` como `active` (verificación implícita wildcard) al asegurar el tenant: [`_seed_dev_tenant`](../backend/app/main.py:42) + [`seed_dev_ops.py`](../backend/scripts/seed_dev_ops.py). Sin hardcode (derivado de `slug` + setting `client_subdomain_base`, vacío = desactivado); idempotente y sin colisión con el CDN. Suite [`test_client_subdomain.py`](../backend/tests/test_client_subdomain.py) |
