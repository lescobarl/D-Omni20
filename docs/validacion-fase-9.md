# Validación de la Fase 9 — Gobernanza del bot (9a = M4 privacidad LFPDPPP + 9b = L1 quotas de tokens)

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan — Fase 9)

> `backend/app/bot/governance.py`      # Servicios de gobernanza: `TokenQuotaService` (L1) y `BotPrivacyService` (M4)
> `backend/app/bot/repositories.py`    # Métodos agregación/borrado/exportación en repos bot (conversaciones + mensajes)
> `backend/app/bot/repository_interfaces.py` # Puerto `BotUsageAggregate` + contratos `aggregate_usage`/`list_all`/`delete_*`
> `backend/app/schemas/bot.py`         # `QuotaUsageRead`/`QuotaUsageResponse`, `BotDataExportRead`, `PrivacyDeletionResult`
> `backend/app/api/v1/bot.py`          # 3 endpoints de gobernanza: quota, exportación y borrado
> `backend/tests/test_bot_governance.py` # 18 pruebas (unitarias + integración de endpoints)
> `backend/.env.example` + `config/settings.py` # `BOT_DATA_RETENTION_DAYS`, `BOT_QUOTA_DAILY_TOKENS`, `BOT_QUOTA_WINDOW_HOURS`

**Entregado como:** la capa de **gobernanza del bot** que cierra los diferidos **G12** del plan de
integración (§15.3 "Fase 9 — Config, tests y validación + M4/L1"): **9a = M4** privacidad LFPDPPP
(exportación, cancelación/borrado físico y retención automática por tenant) y **9b = L1** quotas de
tokens/consumo sobre los mensajes persistidos con alertas estructuradas. Todo sobre el stack ya
validado de las Fases 3-7: repositorios por puertos inyectados vía DI (regla CLAUDE), RLS por tenant,
logging estructurado JSON y endpoints protegidos por `X-Tenant-Id`.

## 2. Entregables creados / modificados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/config/settings.py` | Configuración de gobernanza: `bot_data_retention_days: int = 180`, `bot_quota_daily_tokens: int = 100_000`, `bot_quota_window_hours: float = 24.0` (regla CLAUDE: configuración, no constantes embebidas). |
| `backend/app/bot/repository_interfaces.py` | Puerto `BotUsageAggregate` (dataclass frozen: `provider_used`, `tokens_used`, `message_count`) + contratos `aggregate_usage`, `list_all`, `delete_all`, `delete_older_than` en los repos de conversación y mensaje. |
| `backend/app/bot/repositories.py` | Implementaciones SQLAlchemy: `aggregate_usage` (suma por `provider_used` en la ventana), `list_all`, `delete_all` (borrado físico), `delete_older_than` (retención por fecha). |
| `backend/app/schemas/bot.py` | `QuotaUsageRead`, `QuotaUsageResponse` (L1), `BotDataExportRead`, `PrivacyDeletionResult` (M4), más `ConversationRead`/`MessageRead` reutilizados por la exportación. |
| `backend/app/bot/governance.py` | `TokenQuotaService.report` (cálculo de ventana, percentiles, estado `ok/warning/exceeded` y alertas) y `BotPrivacyService.export/erase/purge_expired` (LFPDPPP) — ver §3. |
| `backend/app/core/di.py` | Propiedades `bot_quota_service` (`IQuotaService`) y `bot_privacy_service` (`IPrivacyService`) — composition root, sin `new`. |
| `backend/app/api/deps.py` | Providers `get_bot_quota_service`/`get_bot_privacy_service` para la inyección en los routers. |
| `backend/app/api/v1/bot.py` | `GET /bot/quota/usage`, `GET /bot/privacy/export`, `DELETE /bot/privacy/data` (todos resuelven el tenant vía `get_current_tenant`). |
| `backend/.env.example` | Variables de entorno nuevas documentadas para operación. |
| `backend/tests/test_bot_governance.py` | 18 pruebas: fronteras de `_quota_status`, reporte quota (ok/warning/exceeded/unlimited + alertas), exportación, borrado físico, purga por retención (habilitada/deshabilitada/solo-antiguos) y los 3 endpoints (200/403). |

## 3. Comportamiento validado

### 9b — L1: Quotas de tokens por tenant (`TokenQuotaService.report`)

- **Ventana deslizante**: `period_start = now - window_hours` (por defecto 24 h, piso 1.0 h) y
  `period_end = now`, ambos `datetime` UTC timezone-aware; `quota_limit = bot_quota_daily_tokens`
  (0 = ilimitado, sin alertas).
- **Agregación por proveedor**: `aggregate_usage(tenant_id, since)` sobre los mensajes persistidos
  agrupa `provider_used`/`tokens_used`/`message_count` en la ventana; se abre `session_scope()` con
  `set_app_current_tenant` (no-op en SQLite, RLS en Postgres).
- **Porcentaje y estado**: `percent = tokens/quota_limit*100` (0 si `quota_limit == 0`); estado
  `ok` (< 80), `warning` (≥ 80), `exceeded` (≥ 100) — fronteras verificadas por test (79.99→ok,
  80.0→warning, 100.0→exceeded).
- **Alertas estructuradas**: `bot.quota.warning` ("Cuota de tokens próxima a superarse") y
  `bot.quota.exceeded` ("Cuota de tokens superada por el tenant") con `tenant_id`, `provider_used`,
  `tokens_used`, `quota_limit`, `percent`; el estado `exceeded` emite **solo** la alerta de excedido
  (no duplica warning).
- **Respuesta**: `QuotaUsageResponse` con totales (`total_tokens_used`, `total_percent`, estado global)
  y el detalle `items` por proveedor.

### 9a — M4: Privacidad LFPDPPP (`BotPrivacyService`)

- **Portabilidad/exportación** (`export`): devuelve `BotDataExportRead` con todas las conversaciones y
  mensajes del tenant (orden FK correcto) y emite `bot.privacy.exported` con los conteos.
- **Cancelación/borrado físico** (`erase`): borra mensajes y luego conversaciones (orden de FK para
  evitar violaciones), devuelve `PrivacyDeletionResult(tenant_id, deleted_conversations,
  deleted_messages)` y emite `bot.privacy.erased`.
- **Retención automática** (`purge_expired`): si `bot_data_retention_days ≤ 0` no borra nada y no emite
  log; en otro caso purga lo anterior a `now - retention_days` con `bot.privacy.retention_purged`
  (incluye `retention_days` y conteos). Test verifica que solo se borra lo antiguo y se conserva lo
  reciente.

### Endpoints

- `GET /api/v1/bot/quota/usage` → 200 `QuotaUsageResponse` (con X-Tenant-Id válido; defaults de la
  suite: `quota_limit=100000`, `total_tokens_used=201`, `total_percent=0.2`, `status=ok`).
- `GET /api/v1/bot/privacy/export` → 200 `BotDataExportRead` (1 conversación + 2 mensajes sembrados).
- `DELETE /api/v1/bot/privacy/data` → 200 `PrivacyDeletionResult` y borrado físico verificado
  (ambos `list_all` vacíos tras el borrado).
- Sin `X-Tenant-Id` → **403** `tenant.isolation_violation` / `tenant.resolve` (fail-closed).

## 4. Mejoras de causa raíz (sin parches)

### 4.1 Validación por suite completa (metodología de cobertura)

**Síntoma:** al ejecutar solo `tests/test_bot_governance.py` la suite falla con
`CovFailUnderWarning: total of 52 is less than fail-under=80` (cobertura 51.77 %), lo que podría
interpretarse como un defecto.

**Causa raíz:** el gate `fail-under=80` de `pyproject.toml` se evalúa sobre **todo** el paquete `app`;
un archivo de test aislado solo cubre el 51.77 % y no puede satisfacerlo por diseño.

**Solución:** validar la cobertura con la **suite completa** (autoritativa). Resultado:
632 pruebas, cobertura total **94.71 %** (≥ 80 ✅). Se documenta en §5 para que la operación
valide siempre con `python -m pytest` sin filtro de archivo.

### 4.2 Configuración de gobernanza por entorno (no hardcode)

**Síntoma/oportunidad:** los umbrales de retención y cuota eran candidatos a constantes embebidas.

**Causa raíz/solución:** se expusieron como `Settings` (`bot_data_retention_days`,
`bot_quota_daily_tokens`, `bot_quota_window_hours`) con defaults seguros y documentación en
`.env.example`, manteniendo la regla CLAUDE de configuración centralizada; los servicios los leen vía
DI (sin `new` ni valores mágicos).

## 5. Resultados de pruebas

### Backend — suite completa (autoritativa para el gate 80 %)

```
python -m pytest -q
632 passed ✅  |  Total coverage: 94.71 %  |  Gate 80 % superado ✅  |  EXIT 0
  (43 archivos de test; 75 archivos con cobertura completa "75 files skipped due to complete coverage")
```

### Backend — Fase 9 (gobernanza, 18 pruebas nuevas)

```
python -m pytest tests/test_bot_governance.py -v
18 passed ✅
  ✓ _quota_status: 6 fronteras parametrizadas (0.0→ok, 79.99→ok, 80.0→warning, 99.99→warning,
    100.0→exceeded, 150.0→exceeded)
  ✓ quota.report: ok sin alertas · warning con `bot.quota.warning` · exceeded solo `bot.quota.exceeded`
    · ilimitado (quota_limit=0) sin alertas · agregación por proveedor en la ventana
  ✓ privacy.export: validación de datos exportados + evento con conteos
  ✓ privacy.erase: borrado físico (mensajes → conversaciones) + evento
  ✓ privacy.purge_expired: retención deshabilitada (0, sin log) · solo-antiguos conserva recientes
  ✓ endpoints: GET /quota/usage (200), GET /privacy/export (200), DELETE /privacy/data (200)
  ✓ sin X-Tenant-Id → 403 `tenant.isolation_violation` / `tenant.resolve`
```

> **Nota metodológica:** el archivo aislado reporta cobertura parcial (51.77 % < 80 %) y falla el gate;
> esto es esperado por diseño — la validación correcta es la suite completa (§4.1).

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: `TokenQuotaService` y `BotPrivacyService` reciben `Database` + `Settings`
  por constructor y se componen en `Container` (`bot_quota_service`, `bot_privacy_service`); los
  repositorios se resuelven por fábricas de puertos (`IBotConversationRepository`,
  `IBotMessageRepository`) sin instancias en el caso de uso.
- **Sin hardcode**: umbrales y ventanas desde `Settings`; mensajes y nombres de evento de log
  estructurados; estados `ok/warning/exceeded` como literales tipados.
- **Multi-tenancy / RLS**: cada operación abre `session_scope()` y fija el tenant de aplicación
  (`set_app_current_tenant`) antes de consultar/escribir; los endpoints resuelven el tenant desde
  `X-Tenant-Id` y fallan con 403 si falta (fail-closed).
- **Auditoría estructurada**: eventos `bot.quota.warning/exceeded`, `bot.privacy.exported/erased/
  retention_purged` con contexto completo (tenant, conteos, umbrales).
- **Estructura y validación**: 18 pruebas nuevas + suite completa en verde; cobertura 94.71 % (≥ 80 %);
  sin parches ni valores mágicos.

## 7. Estado del backlog

| Fase | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fase 3 — Prov. IA / context bundle cliente | COMPLETADO ✅ |
| Fase 4 — Proveedores de IA | COMPLETADO ✅ |
| Fase 5 — Canal WhatsApp + context bundle | COMPLETADO ✅ |
| Fase 5.1 — Cola Redis Streams (D3) | COMPLETADO ✅ |
| Fase 6 — Servicio de conversación (reuso de workflows) | COMPLETADO ✅ |
| Fase 6.1 — Sender tenant-aware (D2) + ligado a la sesión | COMPLETADO ✅ |
| Fase 7 — Frontend Bots/Conversaciones | COMPLETADO ✅ |
| **Fase 9 — Gobernanza del bot (9a M4 + 9b L1)** | **COMPLETADO ✅** |
| Fase C — Cutover / go-live del webhook (runbook) | Pendiente |
| Fase O — Monitoreo y alertas operacional | Pendiente (paralela a C) |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
