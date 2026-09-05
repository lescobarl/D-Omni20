# Validación de la Fase 6.1 — Sender tenant-aware (D2) ligado a la sesión del request

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan — Fase 6.1, D2)

> `bot/channels/factory.py`      # `ChannelSenderFactory`: adaptador por `channel_id` + sender por tenant
> `api/deps.py`                  # `get_channel_sender_factory` request-scoped ligada a la sesión
> `services/workflow_service.py` # `capture_lead` consume la fábrica tenant-aware (sin hardcode global)
> `tests/test_bot_channel_factory.py` # 11 pruebas hermeticas de la fábrica (canales reales cifrados)

**Entregado como:** la fábrica **tenant-aware** de adaptadores y senders de canal que resuelve
las credenciales de cada WABA desde `tenant_channels` (secretos cifrados en reposo), habilitando
**multi-WABA por empresa** sin fallback global de credenciales. Implementa dos puertos:

- `IChannelSenderFactory.resolve(channel_id)` — adaptador concreto del canal (lo usa el worker de la cola D3).
- `IWhatsAppSenderFactory.resolve_sender_for_tenant(tenant_id)` — sender de WhatsApp del tenant (lo usa `WorkflowService.capture_lead`).

Todo el flujo es **fail-closed**: sin canal, tipo no soportado, canal deshabilitado o credenciales
incompletas devuelven `None` y registran un evento estructurado de auditoría.

## 2. Entregables creados / modificados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/channels/factory.py` | `ChannelSenderFactory(IChannelSenderFactory, IWhatsAppSenderFactory)`: constructor con `session: Session | None = None` (sesión ligada opcional), `_repository()` (contextmanager que reutiliza la sesión del request o abre `session_scope` propia en el worker), `resolve` (channel_id → adaptador), `resolve_sender_for_tenant` (tenant → sender habilitado con credenciales), `_has_credentials` y `_build_sender` (sender efímero con credenciales descifradas). |
| `backend/app/api/deps.py` | `get_channel_sender_factory` **request-scoped** (`session: Session = Depends(get_session)`): construye la fábrica por request ligada a la transacción ya abierta; se inyecta en `get_workflow_service` como `IWhatsAppSenderFactory`. El singleton `container.channel_sender_factory` (sin sesión) se conserva para el worker D3. |
| `backend/app/services/workflow_service.py` | `capture_lead` inyecta la fábrica tenant-aware por DI (nada de credenciales globales hardcodeadas); limpieza ruff (`F401 LeadStatus`, `UP017 timezone.utc → datetime.UTC` ×2). |
| `backend/tests/test_bot_channel_factory.py` | 11 pruebas de la fábrica sobre canales reales en el SQLite compartido (secretos cifrados), **herméticas**: cada test que crea canal usa un tenant `uuid.uuid4()` fresco — elimina la polución entre archivos de test (ver §4.2). |

## 3. Comportamiento validado

- **Adaptador por `channel_id` (`resolve`)**: canal WhatsApp con credenciales → `WhatsAppCloudChannelAdapter`; canal inexistente, tipo no soportado (p. ej. `sms`), deshabilitado o sin credenciales → `None` con evento estructurado (`bot.factory.channel_not_found` / `unsupported_channel` / `missing_credentials` / `resolved`).
- **Sender por tenant (`resolve_sender_for_tenant`)**: recorre los canales `whatsapp` del tenant y devuelve el primer canal **habilitado y con credenciales** (`phone_number_id` + `access_token`); sin canal habilitado → `None` con `bot.factory.no_sender_for_tenant`. Valida `enabled` explícitamente porque `get_by_type` filtra tenant+no-delete pero **no** `enabled` (fail-closed).
- **Cifrado en reposo**: los secretos se descifran con `TokenCipher` en `_build_sender`; el sender efímero se construye con `whatsapp_timeout_seconds` desde `Settings` (sin hardcode).
- **Camino HTTP sin deadlock**: la fábrica ligada a la sesión del request reutiliza la transacción ya abierta por `get_current_tenant` — sin segunda conexión escritora en SQLite; en PostgreSQL (MVCC) es agnóstico al dialecto.
- **Camino worker intacto**: el singleton del container (sin sesión ligada) abre su propia `session_scope` — seguro porque el worker no vive dentro de un request HTTP.

## 4. Mejoras de causa raíz (sin parches)

### 4.1 `sqlite3.OperationalError: database is locked` en el camino HTTP (producción)

**Síntoma:** 3 pruebas de `tests/test_workflows.py` (`create_checkout`, `capture_lead`,
`schedule_appointment`) fallaban de forma intermitente con `database is locked`.

**Causa raíz:** `Database` aplica `BEGIN IMMEDIATE` en **toda** transacción (SQLite, `busy_timeout=30000`).
`get_current_tenant` llama `set_app_current_tenant(session.connection(), tenant_id)` en cada request,
lo que **abre la transacción del request en la conexión A** (lock `RESERVED`) antes de que el endpoint
corra; permanece abierta hasta que `get_session` cierra su `session_scope` tras el endpoint. Entonces,
cualquier `session_scope` anidada sobre el mismo `Database` durante el request (una segunda conexión B
haciendo `BEGIN IMMEDIATE`) bloquea hasta 30 s y lanza `database is locked`. PostgreSQL (prod) con MVCC
no se ve afectado.

**Solución (producción):** ligar la fábrica a la sesión del request en el camino HTTP.

- `ChannelSenderFactory` acepta `session: Session | None = None`; si se provee, `_repository()` reutiliza
  esa sesión (misma conexión → sin segundo escritor → sin deadlock); si es `None` (singleton del container),
  conserva su `session_scope` propia para el worker.
- `get_channel_sender_factory` en `deps.py` es **request-scoped** (`session: Session = Depends(get_session)`).
  FastAPI cachea `get_session` por request, así que la misma instancia de sesión se comparte con
  `get_current_tenant` y con los repositorios.
- `get_whatsapp_channel_adapter` **no se tocó**: se verificó que solo se usa en los webhooks de `bot.py`
  (`verify_webhook`, `extract_phone_number_id`), lógica pura sin envíos ni acceso a BD. Las respuestas
  reales las envía el **worker** vía `container.channel_sender_factory` (session=None, `session_scope` propia).

**Calidad ruff (tocados por Fase 6.1):** `factory.py`, `workflow_service.py` y
`tests/test_bot_channel_factory.py` quedan **ruff-clean** (`ruff check` → "All checks passed!").
`deps.py` conserva exactamente **73 hallazgos `B008 function-call-in-default-argument`** (`= Depends(...)`):
es la convención pre-existente y deliberada del archivo en todo el proyecto (FastAPI estándar de este
código base); **no se refactorizó a `Annotated`** por ser un cambio masivo con riesgo de regresión y
ajeno al alcance de esta fase (se documenta, no se parchea).

### 4.2 Fallo de suite completa por polución entre archivos de test (tests)

**Síntoma:** `test_tenant_config_api.py::test_channel_list_no_secrets` fallaba con
`TenantChannelRead.channel_type Input should be 'whatsapp' [type=literal_error, input_value='sms']`
en `app/api/v1/channels.py:40` (500 al listar canales del tenant de desarrollo).

**Causa raíz:** `test_bot_channel_factory.py::test_resolve_unsupported_channel_returns_none` insertaba
un canal `sms` para el **tenant de desarrollo compartido** (fixture session-scoped) en el SQLite
compartido; al correr después `test_channel_list_no_secrets` (orden alfabético) listaba los canales del
dev-tenant e impactaba la fila `sms` huérfana, que `TenantChannelRead` (`Literal['whatsapp']`) no puede
validar → 500. No estaba causado por el fix de producción (ese cambio no toca la creación de canales).

**Solución (tests, sin parches):** **hermetizar** las pruebas que crean canales en
`test_bot_channel_factory.py` — las 5 pruebas que crean canal usan ahora un tenant `uuid.uuid4()` fresco
(se eliminó el parámetro de fixture `tenant_id: uuid.UUID` compartido). Cada prueba crea sus propios
canales, así que ninguna depende del dev-tenant compartido ni de otras pruebas. Se mantiene el patrón de
hermeticidad ya establecido en la fase anterior (los 3 tests negativos de `resolve_sender_for_tenant` ya
usaban tenants frescos).

## 5. Resultados de pruebas

### Subset (fábrica de canales — Fase 6.1)

```
ruff check app/bot/channels/factory.py app/services/workflow_service.py \
          tests/test_bot_channel_factory.py
All checks passed! ✅

ruff check app/api/deps.py --select B008 --statistics
73 B008 function-call-in-default-argument   (convención pre-existente, no refactorizada)

python -m pytest --no-cov tests/test_bot_channel_factory.py \
                        tests/test_tenant_config_api.py \
                        tests/test_workflows.py tests/test_bot_queue.py \
                        tests/test_bot_conversation.py
75 passed ✅   (fábrica + tenant-config + workflows + cola + conversación)
```

### Suite completa (con cobertura)

```
python -m pytest -q
600 passed ✅  |  Total coverage: 94.33%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase 6.1

| Módulo | Cobertura |
| --- | --- |
| `app/bot/channels/factory.py` | 100% (archivo sin líneas descubiertas en el reporte) |
| `app/api/deps.py` | 91% |
| `app/services/workflow_service.py` | 77% |
| `app/bot/channels/whatsapp.py` | 91% |
| `app/bot/queue/worker.py` | 81% |

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: la fábrica se compone en `app.core.di` (`container.channel_sender_factory`,
  sin sesión ligada, para el worker) y por request en `app.api.deps.get_channel_sender_factory` (con la
  sesión del request); se inyecta en `WorkflowService.capture_lead` como `IWhatsAppSenderFactory`
  (inversión de dependencias por puertos).
- **Multi-tenancy / RLS**: `resolve_sender_for_tenant` filtra por `tenant_id` vía repositorio; el canal
  de otro tenant nunca se resuelve; los secretos viajan cifrados en reposo y se descifran solo al
  construir el sender efímero.
- **Sin hardcode**: `_WHATSAPP = "whatsapp"` es constante del módulo; timeouts desde `Settings`;
  sin credenciales globales embebidas; el sender se construye por canal (multi-WABA).
- **Auditoría estructurada**: eventos `bot.factory.resolved`, `channel_not_found`,
  `unsupported_channel`, `missing_credentials`, `sender_resolved`, `no_sender_for_tenant` con
  `tenant_id`/`channel_id`/`channel_type` para correlación.
- **Fail-safe / fail-closed**: cualquier canal no enviable → `None` (nunca un sender con credenciales
  incompletas); la ausencia de canal no rompe el webhook (worker reintenta y DLQ).

## 7. Estado del backlog

| Fase | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fase 3 — Prov. IA / context bundle cliente | COMPLETADO ✅ |
| Fase 4 — Proveedores de IA | COMPLETADO ✅ |
| Fase 5 — Canal WhatsApp + context bundle | COMPLETADO ✅ |
| Fase 5.1 — Cola Redis Streams (D3) | COMPLETADO ✅ |
| Fase 6 — Servicio de conversación (reuso de workflows) | COMPLETADO ✅ |
| **Fase 6.1 — Sender tenant-aware (D2) + ligado a la sesión** | **COMPLETADO ✅** |
| Fase 7 — Frontend Bots/Conversaciones | Pendiente |
| Fase C — Cutover del webhook | Pendiente |
| Fase 9 — Config, tests y validación (9a M4 / 9b L1) | Pendiente |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
