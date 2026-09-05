# Validación de la Fase 6 — Servicio de conversación (reuso de workflows por DI)

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan — reuso de workflows existentes)

> `bot/conversation_service.py`  # Servicio de conversación del bot (Fase 6)
> `core/di.py`                   # Composición: `conversation_service` + `bot_worker_pool`
> `bot/queue/__init__.py`        # Corrección de exports de constantes de cola (Fase 5.1)
> `tests/test_bot_conversation.py` # 13 pruebas del servicio de conversación

**Entregado como:** el caso de uso de conversación del bot con **un solo dueño por
transacción** (checkout / lead / quote / appointment). El servicio **nunca reimplementa**
los flujos de negocio: detecta la intención del mensaje y **delega vía servicios
inyectados** (`IWorkflowService`) construidos por factories DI por sesión. La RLS
multi-tenant sigue aplicando en todo momento (`set_app_current_tenant` antes de tocar BD).

Flujo: context bundle (m2m, resuelto fuera de sesión) → `session_scope()` con tenant fijo
→ `upsert` de la conversación → historial → detección de intención → dispatch a workflow
(`create_checkout` / `capture_lead` / `generate_quote` / `schedule_appointment`) o
`_general_chat` vía el router de proveedores IA → persistir SOLO el mensaje saliente
(el entrante lo persiste la cola D3 de Fase 5.1) → auditoría → respuesta. El `adapter`
queda inactivo en Fase 6 (envío en Fase 6.1); el worker ya consume el servicio.

## 2. Entregables creados / modificados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/conversation_service.py` | `ConversationService(IConversationService)`: `handle_inbound` (bundle → sesión tenant-scoped → upsert conversación → historial → intención → workflow/general chat → persistir saliente → auditoría), `_load_history` (20 turnos, roles `user`/`assistant`), `_general_chat` (router de proveedores + `ConversationContext`), `_select_provider` (primer proveedor habilitado; proveedor local sintético si no hay), `_detect_intent` + extracción (email/phone/amount/datetime/currency/name/catálogo), 4 handlers de workflow y `_clarify`. |
| `backend/app/core/di.py` | Composición del container: `conversation_service` (singleton con factories `conversation_repository_factory`/`message_repository_factory`/`audit_service_factory`/`workflow_service_factory`/`provider_router_factory`) y `bot_worker_pool` (worker con el servicio como processor y `adapter=None`). |
| `backend/app/bot/queue/__init__.py` | Corrección de exports: faltaban `CONVERSATION_STATE_ACTIVE` y `DIRECTION_INBOUND` (el servicio importa las 4 constantes desde `app.bot.queue`); ahora los 8 símbolos están en el paquete y en `__all__`. |
| `backend/tests/test_bot_conversation.py` | 13 pruebas del servicio (delegación + persistencia + auditoría, caminos de clarificación, fallback de general chat, reuso de conversación/historial, `NotFoundError`, rollback ante excepción de workflow). |

## 3. Comportamiento validado

- **Un solo dueño por transacción**: ante intención, el servicio construye el
  `*Request` (pydantic, `extra="forbid"`) y delega en `IWorkflowService` por DI; los
  metadatos de respuesta reflejan el resultado del workflow (`payment_id`, `lead_id`,
  `quote_id`, `appointment_id`). El bot no reimplementa checkout/lead/cotización/cita.
- **Persistencia correcta**: `handle_inbound` hace `upsert` de la conversación (estado
  `active` + `last_message_at`) y persiste **un** `BotMessage` saliente
  (`DIRECTION_OUTBOUND`, `QUEUE_SENT`, `provider_used`). El mensaje entrante lo persiste
  la cola D3 de Fase 5.1 (`enqueue_inbound`).
- **Detección de intención por prioridad**: checkout → appointment → quote → lead; extrae
  email/phone/monto/moneda/fecha-hora/nombre y empareja el catálogo de la empresa
  (servicios disponibles con precio).
- **Clarificación proactiva**: checkout sin monto, lead sin email, quote sin servicio
  emparejado y appointment sin servicio+fecha devuelven `BotResponse` de clarificación
  (`provider_kind="conversation"`, `provider_used="clarify"`) en lugar de fallar.
- **General chat**: sin intención, responde con el router de proveedores IA usando el
  contexto de la empresa (`ConversationContext` con `tenant_id`, `conversation_id`,
  `channel_id`, `external_contact_id`, proveedor y historial); se reutiliza la misma
  conversación entre turnos y el historial mapea roles `inbound→user` / `outbound→assistant`.
- **Multi-tenancy / RLS**: `set_app_current_tenant` antes de cada operación; canal
  desconocido → `NotFoundError` (404, `resource.not_found`) sin tocar BD; si el workflow
  lanza, la sesión hace rollback y **no se persiste nada** (conversación, mensaje ni
  auditoría).
- **Auditoría estructurada**: evento `bot.conversation.reply` con `entity_type="bot_message"`,
  `entity_id`, y detalles (`conversation_id`, `intent`, `provider_kind`, `provider_used`,
  `needs_human`, `channel_id`, `external_contact_id`) + log `bot.conversation.replied`.

## 4. Mejoras incorporadas (causa raíz → solución)

Durante la validación se detectaron y corrigieron **2 fallos de causa raíz** (sin parches):

1. **Bug de importación en `app/bot/queue/__init__.py`** — el servicio importa
   `CONVERSATION_STATE_ACTIVE, DIRECTION_INBOUND, DIRECTION_OUTBOUND, QUEUE_SENT` desde
   `app.bot.queue`, pero el paquete solo re-exportaba `QUEUE_SENT` y `DIRECTION_OUTBOUND`
   → **`ImportError` en tiempo de ejecución** (ruff no lo detecta porque no ejecuta
   imports). **Solución (producción):** añadir `CONVERSATION_STATE_ACTIVE` y
   `DIRECTION_INBOUND` a la línea `from app.bot.queue.service import (...)` y a `__all__`
   en `__init__.py`; los 8 símbolos quedan disponibles.
2. **Firma de paginación en los repositorios** — los helpers de prueba usaban
   `list(tenant_id=...)`, pero `list()` exige `page` y `page_size` (y devuelve
   `tuple[list, int]`). **Solución (tests):** los helpers pasan `page=1, page_size=1000` y
   desempaquetan el total; sin tocar código de producción.

**Calidad ruff (tocados por Fase 6):** `conversation_service.py`, `core/di.py`,
`queue/__init__.py` y `tests/test_bot_conversation.py` quedan **ruff-clean**
(`ruff check` + `ruff format --check`), tras aplicar `ruff --fix` (orden de imports, I001)
y `ruff format` sobre los 3 archivos con desviaciones de formato.

## 5. Resultados de pruebas

### Subset (servicio de conversación — Fase 6)

```
ruff check app/bot/conversation_service.py app/bot/queue/__init__.py \
          app/core/di.py tests/test_bot_conversation.py
All checks passed! ✅

ruff format --check app/bot/conversation_service.py app/bot/queue/__init__.py \
           app/core/di.py tests/test_bot_conversation.py
4 files already formatted ✅

python -m pytest --no-cov tests/test_bot_conversation.py
13 passed ✅   (4 delegación+persistencia+auditoría, 5 clarificación,
               2 general chat, 1 NotFoundError, 1 rollback)
```

### Suite completa (con cobertura)

```
python -m pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=80
573 passed ✅  |  Total coverage: 94.33%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase 6

| Módulo | Cobertura |
| --- | --- |
| `app/bot/conversation_service.py` | 91% |
| `app/bot/context_bundle_service.py` | 74% |
| `app/bot/repositories.py` | 94% |
| `app/core/di.py` | 93% |
| `app/api/deps.py` | 91% |

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: el servicio se compone en `app.core.di`
  (`container.conversation_service`) e inyecta `Database`, `ContextBundleService`,
  `Settings`, `ILogger` y factories (`conversation_repository_factory`,
  `message_repository_factory`, `audit_service_factory`, `workflow_service_factory`,
  `provider_router_factory`); el acceso HTTP queda disponible vía
  `get_conversation_service` (Fase 7).
- **Un solo dueño por transacción**: el bot **nunca** reimplementa checkout/lead/quote/
  cita; delega vía `IWorkflowService` (DI por sesión). Los esquemas pydantic
  (`extra="forbid"`) garantizan contratos estrictos.
- **Multi-tenancy / RLS**: `set_app_current_tenant(connection, tenant_id)` antes de toda
  operación; los repositorios filtran por `tenant_id`; canal desconocido → `NotFoundError`
  sin efectos secundarios; excepción de workflow → **rollback total**.
- **Sin hardcode**: intenciones/prioridades/patrones de extracción son constantes del
  módulo; `_MAX_HISTORY_TURNS`/`_LEAD_SOURCE` parametrizados; config LLM del bot desde
  `Settings` (`bot_llm_*`); no hay valores mágicos embebidos.
- **Auditoría estructurada**: evento `bot.conversation.reply` con contexto descriptivo y
  correlación; log `bot.conversation.replied` con los mismos campos.
- **Fail-safe**: la clarificación guía al usuario en datos faltantes; la excepción de
  workflow no deja estado intermedio (rollback atómico).

## 7. Estado del backlog

| Fase | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fase 3 — Prov. IA / context bundle cliente | COMPLETADO ✅ |
| Fase 4 — Proveedores de IA | COMPLETADO ✅ |
| Fase 5 — Canal WhatsApp + context bundle | COMPLETADO ✅ |
| Fase 5.1 — Cola Redis Streams (D3) | COMPLETADO ✅ |
| **Fase 6 — Servicio de conversación (reuso de workflows)** | **COMPLETADO ✅** |
| **Fase 6.1 — Sender tenant-aware (D2) + ligado a la sesión** | **COMPLETADO ✅** |
| Fase 7 — Frontend Bots/Conversaciones | Pendiente |
| Fase C — Cutover del webhook | Pendiente |
| Fase 9 — Config, tests y validación (9a M4 / 9b L1) | Pendiente |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
