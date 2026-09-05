# Runbook de Cutover / Go-live del Webhook de WhatsApp — Fase C

**Proyecto:** OmniBotIA Studio (D-Omni2.0)
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** LISTO PARA EJECUTAR ✅ (depende de la operación manual en Meta WABA)

---

## §1 Propósito (Fase C)

Reconfigurar la **WABA (WhatsApp Business API)** del despliegue standalone de
**OmniBot_IA/** hacia el endpoint de **D-Omni2.0**, validar la **paridad de
respuestas** entre ambos despliegues y **apagar el despliegue antiguo**
(decommissioning).

> **Definición de done (plan §15.3, Bloque E):** *"El objetivo no se cumple hasta
> que el tráfico real fluye por D-Omni2.0 y el proyecto hermano deja de operar."*

Este runbook es **operacional** (requiere acciones manuales en el portal de Meta
y en los hosts de despliegue). No modifica código: el código de los webhooks ya
está implementado y validado en las Fases 5/5.1/9.

---

## §2 Arquitectura objetivo

```
Cliente WhatsApp
      │
      ▼
Meta Cloud API (WABA)
      │  POST https://<D-Omni2.0-host>/api/v1/bot/channels/whatsapp/webhook
      │  (X-Hub-Signature-256 firmada con webhook_secret del canal)
      ▼
FastAPI (D-Omni2.0 backend)
      │  app/api/v1/bot.py
      │
      ├── resolve_by_phone_number_id(phone_number_id)  → TenantChannel
      ├── verify_signature(webhook_secret, body, signature)  → 200 | 403
      ├── parse_inbound(data)                          → InboundMessage
      └── enqueue_inbound(...)                         → Redis Streams D3 (fuente de verdad: bot_messages)
              │
              ▼
       Worker pool D3 → ConversationService → proveedor IA → respuesta → WhatsApp
```

**Puntos de entrada (implementados y probados):**

| Método | Ruta | Responsabilidad |
|--------|------|-----------------|
| `GET` | [`verify_whatsapp_webhook()`](../backend/app/api/v1/bot.py:88) | Handshake Meta: resuelve `verify_token` por canal y devuelve `hub.challenge` (403 fail-closed si no coincide). |
| `POST` | [`receive_whatsapp_webhook()`](../backend/app/api/v1/bot.py:149) | Mensaje entrante: resuelve canal por `phone_number_id`, verifica firma `X-Hub-Signature-256`, persiste y encola. |

---

## §3 Prerrequisitos (checklist)

Antes de reconfigurar la WABA, **todo** lo siguiente debe estar en verde:

- [ ] **Acceso público HTTPS** al backend D-Omni2.0 (dominio + TLS válido). Meta
      **rechaza** URLs HTTP en texto plano o sin certificado válido.
- [ ] **Backend levantado** con `run_dev.py`/uvicorn y verificado con
      `curl https://<host>/api/v1/health`.
- [ ] **Redis disponible** (la cola D3 requiere `REDIS_URL`). Regla D3: Redis con
      AOF habilitado; `bot_messages` en PostgreSQL es la **fuente de verdad**.
- [ ] **Canal WhatsApp configurado** en `tenant_channels` con:
      `verify_token`, `webhook_secret`, `phone_number_id` (datos cifrados en
      reposo vía `TokenCipher`).
- [ ] **Variables de entorno** (ver [`backend/.env.example`](../backend/.env.example:1)):
      `BOT_FEATURE_ENABLED=true`, `BOT_CONTEXT_TIMEOUT_SECONDS`, `BOT_QUEUE_STREAM_PREFIX`,
      `BOT_WORKER_GROUP`, `REDIS_URL`, `OMNI2_API_BASE_URL`.
- [ ] **Service credential m2m** para los endpoints protegidos (monitoreo de cola):
      `OMNI2_SERVICE_CREDENTIAL` y cabecera `X-Service-Credential`.
- [ ] **Suite de pruebas en verde**: backend 632 tests / 94.71% cobertura
      (ver [`validacion-fase-9.md`](validacion-fase-9.md)).
- [ ] **Worker D3 activo** (`bot_worker_pool` consumiendo el stream).

---

## §4 Reconfiguración de la WABA (Meta Cloud API)

En el portal de **Meta Business Manager → WhatsApp → Configuración de API**:

1. **Callback URL**: sustituir la del despliegue standalone de OmniBot_IA por
   ```
   https://<D-Omni2.0-host>/api/v1/bot/channels/whatsapp/webhook
   ```
2. **Verify token**: introducir el `verify_token` **exacto** configurado en el
   canal de D-Omni2.0 (el mismo que usa
   [`resolve_by_verify_token()`](../backend/app/repositories/sqlalchemy_repositories.py:1143)).
3. **Campos suscritos**: mantener `messages` activo.
4. Guardar. Meta disparará de inmediato el **handshake** (paso §5).

> ⚠️ **No** reutilizar el `verify_token` del despliegue antiguo a menos que el
> canal de D-Omni2.0 se haya creado con ese mismo valor. El token se resuelve
> **por canal** (`resolve_by_verify_token`) y un fallo devuelve **403**.

---

## §5 Validación del handshake (GET)

Meta llama a la URL de callback con los parámetros `hub.mode`, `hub.verify_token`
y `hub.challenge`. El backend responde:

| Escenario | Comportamiento observado (código) |
|-----------|------------------------------------|
| `verify_token` válido | `200` con `hub.challenge` tal cual (echo exacto que Meta exige). Log `bot.webhook.verified`. |
| Token desconocido | `403` `TenantIsolationError` (`bot.webhook.verify`) — fail-closed. |
| `mode` distinto de `subscribe` | `403` (`bot.webhook.verify`). |
| Token ausente | `403` (`bot.webhook.verify`). |

**Comprobación manual (sustituir valores):**
```bash
curl -i "https://<D-Omni2.0-host>/api/v1/bot/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<verify_token>&hub.challenge=CHALLENGE_123"
# Esperado: HTTP/1.1 200 OK  —  body: CHALLENGE_123
```

**Confirmación en logs del backend:**
```
event="bot.webhook.verified" channel_id="<uuid>" tenant_id="<uuid>"
```

Si el handshake falla, Meta muestra error en el portal. Depurar contra
[`verify_whatsapp_webhook()`](../backend/app/api/v1/bot.py:88) y los tests
[`test_verify_webhook_*`](../backend/tests/test_api_bot.py:155).

---

## §6 Validación de paridad (POST / mensaje real)

Con el handshake confirmado, enviar un mensaje real desde un número de prueba
(número verificado o destinatario de prueba de Meta):

1. **POST recibido**: Meta envía el payload al endpoint.
   ```bash
   curl -i -X POST "https://<D-Omni2.0-host>/api/v1/bot/channels/whatsapp/webhook" \
     -H "Content-Type: application/json" \
     -H "X-Hub-Signature-256: sha256=<hmac>" \
     -d '{"object":"whatsapp_business_account","entry":[...]}'
   ```
2. **Resultados esperados** (validados en [`test_api_bot.py`](../backend/tests/test_api_bot.py:224)):
   - Canal conocido + firma válida + mensaje → `200 {"status":"ok"}`
     (mensaje persistido en `bot_messages` y encolado en el stream D3).
   - Firma inválida → `403` `bot.webhook.signature.rejected`.
   - Canal desconocido / sin mensaje / evento de estado → `200` confirmación (Meta
     exige acuse en 24 h; devolver error provoca reintentos y penalización).
3. **Verificar en BD** (fuente de verdad):
   ```sql
   SELECT direction, queue_status, content
     FROM bot_messages
    WHERE tenant_id = '<tenant_uuid>'
    ORDER BY created_at DESC LIMIT 5;
   ```
4. **Verificar la cola Redis D3** (estadísticas combinadas BD + Redis):
   ```bash
   curl -s -H "X-Tenant-Id: <tenant_uuid>" -H "X-Service-Credential: <svc>" \
     "https://<D-Omni2.0-host>/api/v1/bot/queue/tenant-stats"
   ```
5. **Paridad de respuestas**: el bot debe responder con la misma calidad que
   OmniBot_IA. Ejecutar la batería de casos de negocio:
   - Saludo / pregunta general (router de proveedores IA con grounding).
   - Intenciones de workflow: checkout, lead, cotización, agendamiento
     ([`ConversationService.handle_inbound()`](../backend/app/bot/conversation_service.py:277)).
   - Casos sin datos completos → respuesta de clarificación (no fallo).

> **Criterio de aceptación de paridad:** para cada caso de negocio probado, la
> respuesta de D-Omni2.0 es funcionalmente equivalente (o superior) a la del
> despliegue standalone.

---

## §7 Cutover / go-live

1. Elegir una ventana de bajo tráfico y registrar la hora de inicio en el log de
   operación.
2. **Congelar cambios** en el despliegue standalone de OmniBot_IA (no desplegar
   nada nuevo; solo lectura).
3. Reconfigurar la WABA (§4) — el tráfico empieza a fluir hacia D-Omni2.0.
4. Confirmar handshake (§5) y primer mensaje real (§6) en los **primeros 15
   minutos**.
5. **Observar la cola**: `GET /api/v1/bot/queue/tenant-stats` — sin DLQ creciente,
   sin PEL acumulado, worker consumiendo con normalidad.
6. Mantener la ventana de observación **≥ 24 h** antes del decommissioning.

> Regla de oro del plan (§16): si en la ventana se detecta fallo fail-closed o
> pérdida de mensajes, ejecutar **rollback (§9)** de inmediato y volver al
> despliegue antiguo; el decommissioning se reanuda después.

---

## §8 Decommissioning del despliegue standalone (OmniBot_IA)

Solo después de que el tráfico real fluya por D-Omni2.0 durante la ventana de
observación sin incidentes:

1. **Detener el worker/proceso** que consume mensajes de OmniBot_IA (dejar de
   responder).
2. **Redirigir/cortar** cualquier cola o cron del proyecto hermano.
3. **Doble verificación**: enviar un nuevo mensaje de prueba y confirmar que llega
   solo a D-Omni2.0 (logs `bot.webhook.*` del backend).
4. **Archivar** (no eliminar de inmediato) los datos de OmniBot_IA conforme a la
   política de retención (Fase 9a: `bot_data_retention_days`, endpoints de
   privacidad `GET /privacy/export` / `DELETE /privacy/data`).
5. **Apagar** los recursos del despliegue standalone (host, base de datos, colas).
6. Actualizar el inventario: marcar el despliegue heredado como **retirado** y
   registrar la fecha.

> El objetivo de Fase C se considera cumplido únicamente cuando el proyecto
> hermano **deja de operar** y todo el tráfico WhatsApp fluye por D-Omni2.0.

---

## §9 Rollback (procedimiento de reversión)

Si el cutover falla en cualquier momento de la ventana de observación:

1. **En el portal de Meta**: restaurar la Callback URL y el `verify_token` del
   despliegue standalone de OmniBot_IA.
2. **Verificar** que Meta confirma el handshake contra el despliegue antiguo.
3. **Reactivar** el worker/proceso del despliegue standalone.
4. **Conciliar mensajes**: revisar el PEL de Redis D3 y la tabla `bot_messages`
   para detectar mensajes no procesados durante la ventana; reencolarlos o
   reprocesarlos manualmente.
5. **Registrar** la causa raíz y la hora de reversión en el log de operación.
6. **Reintentar** el cutover en una nueva ventana tras corregir la causa.

**Causas típicas de rollback:** TLS/certificado expirado, Redis caído, worker D3
detenido, `verify_token`/`webhook_secret` desincronizados con la WABA.

---

## §10 Monitoreo post-cutover

| Qué monitorear | Cómo |
|----------------|------|
| Salud del endpoint | `GET /api/v1/health` + alertas de uptime |
| Handshake/errores | Logs `bot.webhook.verified`, `bot.webhook.signature.rejected` (auditoría estructurada JSON) |
| Cola D3 | `GET /api/v1/bot/queue/tenant-stats` (PEL, DLQ, streams) |
| Cuota de tokens | `GET /api/v1/bot/quota/usage` (Fase 9b: umbrales ok/warning/exceeded) |
| Privacidad/retención | `purge_expired` de retención (Fase 9a, `bot_data_retention_days`) |

Los logs de eventos (`bot.webhook.*`, `bot.quota.*`, `bot.privacy.*`) siguen el
formato JSON estructurado de [`logging.py`](../backend/app/core/logging.py:25).

---

## §11 Cumplimiento (reglas CLAUDE)

- **Sin parches / sin hardcode**: el runbook no introduce código; la operación
  usa exclusivamente configuración por `Settings` y canales por BD.
- **DI / puertos**: el flujo completo depende de puertos (repositorios, cola,
  adaptadores) sin `new` en la capa HTTP.
- **RLS multi-tenant**: cada resolución (`resolve_by_*`) y persistencia se hace
  bajo `company_scope` con el tenant correcto.
- **Fail-closed**: cualquier discrepancia de firma o `verify_token` devuelve 403,
  nunca acepta tráfico no verificado.
- **Auditoría estructurada**: todos los eventos clave quedan en logs JSON
  consultables.

---

## §12 Estado del backlog

| Fase | Estado |
|------|--------|
| Fases 0–7 (M, 3, 4, 5, 5.1, 6, 6.1, 7) | COMPLETADO ✅ |
| Fase 9 (9a M4 privacidad + 9b L1 cuota) | COMPLETADO ✅ |
| **Fase C (este runbook)** | **LISTO PARA EJECUTAR** ✅ |
| Fase O (monitoreo) | Pendiente (paralela a C) |
| Fase 8 (multired) | Pendiente (opcional) |
| Validación productiva final | Pendiente (tras C y O) |
