# Validación de la Fase 5 — Canal WhatsApp + Context Bundle (runtime del bot)

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan §8.1 y §8.2)

> `bot/channels/whatsapp.py` # Adaptador del canal WhatsApp Cloud API (verify + firma + parseo + envío)
> `api/v1/bot.py`           # Webhooks GET/POST WhatsApp + context bundle m2m (`GET /context/{channel_id}`)
> `bot/context_bundle_service.py` # Servicio que resuelve el bundle de contexto de la empresa por canal
> `schemas/bot.py`          # Esquemas de la API runtime (`BotProviderRead`, `ContextBundleRead`)
> `api/deps.py`             # `require_service_credential` (m2m bearer) + proveedores DI del bot

**Entregado como:** el subsistema runtime del bot sobre los modelos de ejecución
(`app/bot/models.py`, Fase M) y la configuración de canales (`TenantChannel`, Fase 2),
con un adaptador de canal WhatsApp Cloud API (Meta) fail-closed en la verificación de
firma, los endpoints de webhook GET/POST y un endpoint m2m de context bundle protegido
por service credential (plan §8.1 M1/R1/D1 y §8.2).

## 2. Entregables creados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/channels/whatsapp.py` | `WhatsAppCloudChannelAdapter`: `verify_webhook` (hub.mode/hub.verify_token/hub.challenge), `verify_signature` (HMAC-SHA256 fail-closed), `parse_inbound` (mensaje texto/estado), `send` (template vía `IWhatsAppSender`) y extracción de `phone_number_id`. |
| `backend/app/api/v1/bot.py` | `GET /api/v1/bot/channels/whatsapp/webhook` (verificación de suscripción) y `POST /api/v1/bot/channels/whatsapp/webhook` (mensajes entrantes, scope de empresa vía `company_scope`); `GET /api/v1/bot/context/{channel_id}` (bundle m2m). |
| `backend/app/bot/context_bundle_service.py` | `ContextBundleService.get_bundle`: resuelve canal → tenant → providers + contenido + catálogo + apariencia, con `prompt_base` derivado como respaldo. |
| `backend/app/schemas/bot.py` | `BotProviderRead` y `ContextBundleRead` (con `from_bundle`) — respuesta m2m sin secretos en bruto no deseados (access_token/webhook_secret solo dentro del bundle protegido). |
| `backend/app/api/deps.py` | `require_service_credential` (m2m bearer; 403 por defecto con `omni2_service_credential` vacío) y los `Depends` del bot (`get_whatsapp_channel_adapter`, `get_context_bundle_service`). |
| `backend/tests/test_bot_channels.py` | 18 pruebas del adaptador WhatsApp (verify, firma, parseo, envío). |
| `backend/tests/test_api_bot.py` | 13 pruebas de integración HTTP (webhooks + context bundle m2m). |

## 3. Comportamiento validado

- **Verificación de webhook (GET)**: `hub.mode == "subscribe"`, `hub.verify_token`
  coincide con el `webhook_secret` cifrado del canal → responde `hub.challenge`
  (texto plano); token desconocido, modo inválido o token faltante → 403 con
  `bot.webhook.verify` (`tenant.isolation_violation`).
- **Firma fail-closed (POST)**: `verify_signature` valida prefijo `sha256=`, secreto
  configurado y HMAC-SHA256 sobre el cuerpo crudo (`hmac.compare_digest`). Firma
  inválida/faltante o secreto ausente → 403 `bot.webhook.signature`; canal
  desconocido por `phone_number_id` se responde 200 sin verificar (no filtra
  existencia de canales).
- **Parseo de inbound**: mensaje de texto → `InboundMessage`; eventos de estado
  (`include_message=False`) o payload sin sender → `None` (se responde 200).
- **Context bundle m2m**: sin service credential → 403 `bot.service.authenticate`;
  canal desconocido → 404 `bot.context.resolve`; canal válido → 200 con
  `tenant_id`, `channel_id`, `channel_type`, `phone_number_id`, `access_token`,
  `webhook_secret`, `prompt_base` (truthy) y `providers/content_items/catalog_items`.
- **Cifrado en reposo**: en test containers `token_cipher=None` → paso en claro; en
  producción los secretos se cifran/descifran con `TokenCipher` (Fase 3) y nunca se
  exponen en las respuestas CRUD de canales (verificado en Fase 2).
- **Tenancy**: el webhook enruta por `phone_number_id` (clave natural del canal) y
  fija `company_scope` con el tenant resuelto; el context bundle resuelve
  exclusivamente por `channel_id` → `tenant_id` (defensa en profundidad).

## 4. Mejora incorporada — ciclo de importación (`app.models`)

Durante la validación, el subset de Fase 5 falló al importar
(`ImportError: cannot import name 'BotCompanyProvider' from partially initialized
module 'app.bot.models'`). Causa: `app/models/__init__.py` re-exportaba de forma
eager los modelos del bot, pero `app.bot.models` importa `app.models.base`; al
arrancar el DI (conftest/main → `app.core.di` → `context_bundle_service` →
`app.bot.repositories` → `app.bot.models`) el paquete quedaba parcialmente
inicializado y el re-export eager rompía el ciclo.

**Solución limpia (sin parches):** reescritura de `backend/app/models/__init__.py`
con resolución perezosa PEP 562 (`__getattr__`) para los 4 modelos del bot
(`BotCompanyProvider`, `BotConversation`, `BotMessage`, `BotQueueMeta`), sin
re-export eager. Los modelos quedan registrados en `Base.metadata` vía la cadena DI
antes de cualquier `create_all` (garantizado en `main.py` y `conftest.py`). Ningún
consumidor importa los modelos del bot a través de `app.models` (todos usan
`from app.bot.models import ...`), por lo que la resolución perezosa es transparente.

## 5. Resultados de pruebas

### Subset (canales + API runtime del bot)

```
ruff check app/models/__init__.py tests/test_bot_channels.py tests/test_api_bot.py
All checks passed! ✅

python -m pytest tests/test_bot_channels.py tests/test_api_bot.py --no-cov -q
31 passed ✅   (18 adaptador + 13 integración HTTP)
```

### Suite completa (con cobertura)

```
python -m pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=80
516 passed ✅  |  Total coverage: 94.56%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase 5

| Módulo | Cobertura |
| --- | --- |
| `app/api/v1/bot.py` | 98% |
| `app/schemas/bot.py` | 97% |
| `app/bot/channels/whatsapp.py` | 91% |
| `app/api/deps.py` | 93% |
| `app/models/__init__.py` | 87% |

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: el adaptador y el context bundle se componen en
  `app.core.di` (`container.whatsapp_sender`, `container.context_bundle_service`,
  `container.whatsapp_channel_adapter`) y se inyectan vía `Depends`; el endpoint
  m2m usa `require_service_credential` para autenticar.
- **Multi-tenancy**: todo acceso es tenant-scoped (resolución por clave natural del
  canal → `tenant_id`) y el request fija `company_scope` con restauración en
  `finally` (`app/bot/company_context.py`).
- **Sin hardcode**: secretos, tokens y config de canales provienen de la base de
  datos (cifrados en reposo); el service credential de m2m viene de `Settings`
  (`omni2_service_credential`) y sin configurar devuelve 403 por defecto.
- **Auditoría estructurada**: eventos `bot.webhook.verify`, `bot.webhook.signature`,
  `bot.webhook.inbound`, `bot.service.authenticate`, `bot.context.resolve`
  (contexto descriptivo + error codes).
- **Fail-safe en webhooks**: el POST nunca expone información de canales a clientes
  no autorizados (200 ante canal desconocido, 403 ante firma inválida) y los errores
  de entrada (JSON inválido / no objeto) responden 422 `bot.webhook.inbound`.

## 7. Estado del backlog

| Fase | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fase 3 — Prov. IA / context bundle cliente | COMPLETADO ✅ |
| Fase 4 — Proveedores de IA | COMPLETADO ✅ |
| **Fase 5 — Canal WhatsApp + context bundle** | **COMPLETADO ✅** |
| Fase 5.1 — Cola Redis Streams (D3) | Pendiente |
| Fase 6 / 6.1 / 7 / C / 9 / 8 | Pendiente |
