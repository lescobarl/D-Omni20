# Validación de la Fase 5.1 — Cola Redis Streams (D3) del bot

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan §8.2, §8.3 y §10.3 — decisión D3)

> `bot/queue/interfaces.py`       # Puertos (ABC): `StreamMessage`, `QueueStats`, `IQueue`
> `bot/queue/redis_stream_queue.py` # Implementación Redis Streams: XADD/XREADGROUP/XACK/XCLAIM/DLQ
> `bot/queue/service.py`          # Servicio de enlace BD ↔ Redis (punto único de entrada del webhook)
> `bot/queue/worker.py`           # Worker pool en proceso (fail-closed) sobre la cola D3
> `api/v1/bot.py`                 # POST webhook (persistir + encolar) + `GET /bot/queue/stats` (monitor)
> `schemas/bot.py`                # `QueueStatsRead` (respuesta del monitor de cola)
> `api/deps.py`                   # `get_bot_queue_service` (proveedor DI de la cola)

**Entregado como:** la cola asíncrona multi-tenant **Redis Streams (D3)** del subsistema
bot sobre los modelos de ejecución (`app/bot/models.py`: `BotMessage`, `BotQueueMeta`,
Fase M). Desacopla el webhook WhatsApp (responde `200` inmediato) del LLM (5-15 s)
siguiendo el flujo del plan §8.2: (1) persistir `bot_messages` en BD (source of truth)
→ (2) `XADD bot:queue:{tenant_id}` con `message_id` → (3) responder `200` → (4) el
worker `XREADGROUP` procesa: context bundle → `IResponseProvider` → envío → (5)
`XACK` + actualizar estado en `bot_messages`. AOF + PEL garantizan **at-least-once**;
DLQ por tenant captura fallos; idempotencia por `message_id` evita re-respuestas ante
reintentos.

## 2. Entregables creados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/queue/interfaces.py` | Puertos `StreamMessage`, `QueueStats` y `IQueue` (enqueue / read_group / ack / claim / pending / xlen / consumer_lag / to_dlq) — inversión de dependencias (regla CLAUDE: DI). |
| `backend/app/bot/queue/redis_stream_queue.py` | `RedisStreamQueue(IQueue)` sobre redis-py 5.x (`decode_responses=True`): `_ensure_group` (XGROUP CREATE MKSTREAM), `enqueue` (XADD), `read_group` (XREADGROUP con tolerancia de `NOGROUP` y `attempts` inválido), `ack`, `claim` (XCLAIM sobre PEL), `xlen`, `pending`, `consumer_lag` (XINFO GROUPS), `to_dlq` (mensaje + `dlq_reason`/`dlq_at`). |
| `backend/app/bot/queue/service.py` | `BotQueueService`: `enqueue_inbound` (persiste `BotMessage` en BD y hace `XADD`; ventana de dedupe por `message_id`; si Redis falla responde `False` sin perder el registro), `requeue_pending` (re-encola desde BD si Redis cayó), `queue_stats` (combinado BD fuente de verdad + Redis cola viva), `list_streams`, `mark_message_status`, `increment_dlq`. |
| `backend/app/bot/queue/worker.py` | `BotWorkerPool`: pool de hilos delgados; `_process_message` con reintentos + backoff (PEL), límite de `attempts` → DLQ, malformado entrega y marca sin romper el ciclo; fail-closed si no hay processor/adapter. |
| `backend/app/bot/queue/__init__.py` | Export del paquete de cola (Fase 5.1). |
| `backend/app/api/v1/bot.py` | `POST /api/v1/bot/channels/whatsapp/webhook` persiste y encola vía `BotQueueService` (responde 200/500 sin exponer canales); `GET /api/v1/bot/queue/stats` (monitor D3 por tenant, m2m con service credential). |
| `backend/app/schemas/bot.py` | `QueueStatsRead` con `from_stats` (XLEN, PEL, DLQ, lag, estados BD, throughput in/out). |
| `backend/app/api/deps.py` | `get_bot_queue_service` (proveedor DI del `BotQueueService` por request). |
| `backend/app/core/di.py` | Composición del container: `queue` (`RedisStreamQueue`), `bot_queue_service`, `bot_worker_pool` (singletons de infraestructura). |
| `backend/tests/test_bot_queue.py` | 15 pruebas del servicio de cola + worker pool (FakeQueue / FakeProcessor / _StubAdapter herméticos). |
| `backend/tests/test_bot_queue_redis.py` | 26 pruebas del adaptador Redis Streams (FakeRedisClient). |
| `backend/tests/test_api_bot.py` | 16 pruebas de integración HTTP (webhook + queue stats + context m2m). |

## 3. Comportamiento validado

- **Flujo D3 completo (§8.2)**: el webhook `POST` persiste `BotMessage` en BD (source of
  truth) y encola `XADD bot:queue:{tenant_id}` con `message_id`; el worker `XREADGROUP`
  procesa, responde y hace `XACK` + actualiza estado — el webhook responde `200`
  inmediato (desacoplado del LLM).
- **At-least-once + PEL**: mensajes no `XACK`ed permanecen en PEL y se reclaman
  (`XCLAIM`) tras idle timeout; reintentos con límite de `attempts` y backoff;
  agotados → **DLQ por tenant** (`to_dlq` con `dlq_reason`/`dlq_at`, contador en
  `bot_queue_meta`).
- **Idempotencia por `message_id`**: la ventana de dedupe en `enqueue_inbound` ignora
  reintentos del webhook dentro de la ventana (no se re-responde ni se duplica); fuera
  de ventana el mensaje se reactiva.
- **Fail-closed del worker**: sin processor/adapter el worker queda dormido; mensajes
  malformados se entregan/marcan sin romper el ciclo; errores del processor se reintentan
  y derivan a DLQ.
- **Re-encolado desde BD**: `requeue_pending` recupera desde `bot_messages` los mensajes
  `pending` si Redis cayó (fuente de verdad garantiza no pérdida).
- **Monitor D3**: `GET /api/v1/bot/queue/stats` con service credential devuelve por
  tenant XLEN, tamaño PEL, lag de consumidores, contador DLQ y estados BD
  (`pending/processing/sent/failed/dlq`); sin credential → 403; tenant faltante → 422.
- **Multi-tenancy**: un stream `bot:queue:{tenant_id}` por tenant; el webhook resuelve
  `phone_number_id` → tenant y opera en scope de empresa; el monitor exige `tenant_id`
  explícito (defensa en profundidad).

## 4. Mejoras incorporadas (causa raíz → solución)

Durante la validación se detectaron y corrigieron **4 fallos de causa raíz** (sin
parches) más una modernización de calidad:

1. **Tests del adaptador Redis (`TypeError: lambda() got unexpected keyword
   'decode_responses'`)** — 24 pruebas de `test_bot_queue_redis.py` fallaban porque el
   lambda de `_build_queue` no aceptaba el kwarg `decode_responses` que inyecta el
   `Settings`. **Solución:** el lambda del cliente falso ahora acepta `**kwargs`, lo que
   refleja fielmente el contrato de redis-py sin hardcodear el flag en cada prueba.
2. **Worker con mensaje malformado (semántica deliver-first)** — `process_message`
   rompía el contrato de *at-least-once* para payloads malformados. **Solución:**
   semántica deliver-first: el mensaje se entrega/marca correctamente y el error de
   parseo no aborta el ack del mensaje ya procesado (PEL limpia, ciclo intacto).
3. **Dedupe con fechas naive/aware (`TypeError: can't subtract offset-naive and
   offset-aware datetimes`)** — en SQLite `created_at` se lee naive y la ventana de
   dedupe restaba contra `now` (aware). **Solución (producción, `service.py`):** se
   normaliza `created_at` naive a `datetime.UTC` antes de calcular `age = (now -
   created_at).total_seconds()` — sin asumir zona del host.
4. **SQLite `database is locked [BEGIN IMMEDIATE]` en el webhook** — el modelo de
   concurrencia de SQLite (`BEGIN IMMEDIATE` al inicio de cada transacción, ver
   `app/core/database.py`) exige **una sola sesión activa a la vez**. El webhook tenía
   la transacción de lectura del request abierta cuando `enqueue_inbound` abría su
   propia `session_scope()`. **Solución (producción, `api/v1/bot.py`):** inyección de la
   sesión compartida (`session: Annotated[Session, Depends(get_session)]` — la MISMA
   instancia cacheada que usa el repositorio de canales) y `session.commit()` temprano
   tras resolver el canal, liberando la cerradura RESERVED antes de encolar.
   `expire_on_commit=False` mantiene `channel` válido tras el commit; en PostgreSQL el
   commit temprano de una transacción de solo lectura es un no-op.

**Modernización ruff (tocados por 5.1, sin tocar código no relacionado):**
`api/v1/bot.py` se refactorizó a handlers `Annotated` (elimina B008 en defaults), con
B904 (`raise ... from None`) para encadenamiento explícito y orden de parámetros
deps-primero / query-`= None`-último (el Annotated sin default de `Depends` no puede
seguir a un parámetro con default en Python); `service.py` migra `timezone.utc` →
`datetime.UTC` (UP017). Ambos archivos quedan **ruff-clean**.

## 5. Resultados de pruebas

### Subset (cola + worker + API runtime del bot)

```
ruff check app/bot/queue tests/test_bot_queue.py tests/test_bot_queue_redis.py \
          app/api/v1/bot.py app/schemas/bot.py app/api/deps.py
All checks passed! ✅

python -m pytest tests/test_bot_queue.py tests/test_bot_queue_redis.py \
         tests/test_api_bot.py --no-cov -q
57 passed ✅   (15 servicio/worker + 26 adaptador Redis + 16 integración HTTP)
```

### Suite completa (con cobertura)

```
python -m pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=80
567 passed ✅  |  Total coverage: 94.29%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase 5.1

| Módulo | Cobertura |
| --- | --- |
| `app/bot/queue/service.py` | 94% |
| `app/bot/queue/redis_stream_queue.py` | 95% |
| `app/bot/queue/worker.py` | 80% |
| `app/bot/repositories.py` | 85% |
| `app/schemas/bot.py` | 96% |
| `app/api/deps.py` | 91% |
| `app/bot/context_bundle_service.py` | 74% |
| `app/api/v1/bot.py` | 100% |

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: la cola se compone en `app.core.di` (`container.queue`,
  `container.bot_queue_service`, `container.bot_worker_pool`) e inyecta el puerto
  `IQueue` vía constructor; el endpoint usa `Depends(get_bot_queue_service)`; el monitor
  m2m usa `require_service_credential`.
- **Multi-tenancy**: stream `bot:queue:{tenant_id}` por tenant + `bot_queue_meta`
  tenant-scoped (RLS); el webhook resuelve canal → tenant antes de tocar BD y opera en
  scope de empresa; los repositorios filtran por `tenant_id`.
- **Sin hardcode**: nombres de stream derivados (`bot:queue:{tenant_id}`), ventana de
  dedupe, límites de reintentos y DLQ vienen de `Settings`/`BotQueueMeta`; no hay
  valores mágicos embebidos.
- **Auditoría estructurada**: eventos `bot.webhook.inbound`, `bot.queue.*`
  (enqueue/stats/requeue) con contexto descriptivo y error codes; el dedupe y la DLQ se
  registran en `bot_messages` (fuente de verdad) y `bot_queue_meta`.
- **Fail-safe / no pérdida**: webhook responde 200 inmediato, el registro BD es la
  fuente de verdad y se re-encola si Redis cae; DLQ por tenant captura fallos;
  at-least-once con idempotencia por `message_id`.

## 7. Estado del backlog

| Fase | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fase 3 — Prov. IA / context bundle cliente | COMPLETADO ✅ |
| Fase 4 — Proveedores de IA | COMPLETADO ✅ |
| Fase 5 — Canal WhatsApp + context bundle | COMPLETADO ✅ |
| **Fase 5.1 — Cola Redis Streams (D3)** | **COMPLETADO ✅** |
| Fase 6 — Reuso de workflows (servicio de conversación) | Pendiente |
| Fase 6.1 — Sender tenant-aware (D2) | Pendiente |
| Fase 7 — Frontend Bots/Conversaciones | Pendiente |
| Fase C — Cutover del webhook | Pendiente |
| Fase 9 — Config, tests y validación (9a M4 / 9b L1) | Pendiente |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
