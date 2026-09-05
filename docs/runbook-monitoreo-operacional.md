# Runbook de Monitoreo y Alertas Operacional — Fase O

**Proyecto:** OmniBotIA Studio (D-Omni2.0)
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** DOCUMENTADO ✅ (operación en producción tras Fase C)

---

## §1 Propósito (Fase O)

Definir las **reglas de alerta**, el **dashboard unificado**, los **runbooks de
incidentes** y el **procedimiento de backup/restore de Redis + AOF** para operar
el bot en producción.

> Definición del plan (§15.1): *"El endpoint `/bot/queue/stats` es el dato; la
> operación real exige alertas y procedimientos (extiende G5 a producción)."*
> Fase **paralela** a 5.1 (cola) y C (cutover).

Esta fase es **operacional/documental**: no añade código al núcleo (el backend ya
expone todos los datos necesarios). Las reglas aquí definidas se materializan en
la plataforma de alertas del operador (Grafana/Prometheus, Datadog, etc.).

---

## §2 Fuentes de datos

### 2.1 Endpoints del bot

| Endpoint | Qué expone | Datos clave |
|----------|------------|-------------|
| [`GET /api/v1/bot/queue/stats`](../backend/app/api/v1/bot.py:255) | Cola D3 de un tenant (m2m, `Authorization: Bearer <service_credential>`) | `stream`, `length`, `pending`, `consumer_lag`, `dlq_count`, `enqueued`, `processed`, `failed` |
| [`GET /api/v1/bot/queue/tenant-stats`](../backend/app/api/v1/bot.py:485) | Cola del tenant del `X-Tenant-Id` (m2m) | Mismos campos, resuelto por tenant |
| [`GET /api/v1/bot/quota/usage`](../backend/app/api/v1/bot.py:502) | Cuota de tokens (Fase 9b / L1) | `total_percent`, `status` (`ok`/`warning`/`exceeded`), límites |
| [`GET /api/v1/bot/privacy/export`](../backend/app/api/v1/bot.py:515) / [`DELETE /privacy/data`](../backend/app/api/v1/bot.py:528) | Privacidad (Fase 9a / M4) | Exportación y borrado LFPDPPP |

Esquema de la respuesta de cola: [`QueueStatsRead`](../backend/app/schemas/bot.py:112)
(campos `length`, `pending`, `consumer_lag`, `dlq_count`, `enqueued`,
`processed`, `failed`).

### 2.2 Logs estructurados JSON

Los logs de auditoría siguen el formato JSON de [`logging.py`](../backend/app/core/logging.py:25).
Eventos relevantes para monitoreo:

- `bot.webhook.verified` / `bot.webhook.signature.rejected` / `bot.webhook.channel_unknown`
- `bot.factory.resolved` / `bot.factory.unsupported_channel` / `bot.factory.missing_credentials`
- `bot.quota.warning` (≥80 %) / `bot.quota.exceeded` (≥100 %)
- `bot.privacy.exported` / `bot.privacy.erased` / `bot.privacy.retention_purged`
- Errores de proveedor LLM (`DependencyError` en [`llm_provider.py`](../backend/app/bot/providers/llm_provider.py:120))

---

## §3 Reglas de alerta

| # | Regla | Umbral | Severidad | Acción |
|---|-------|--------|-----------|--------|
| A1 | **Lag de PEL** (`pending` o `consumer_lag`) | `pending > 0` sostenido o `consumer_lag > 5 min` | Alta | Revisar worker D3: ¿está corriendo? ¿Redis accesible? |
| A2 | **DLQ creciente** | `dlq_count` incrementa entre muestras consecutivas | Alta | Extraer mensajes de DLQ, revisar causa (adapter no resuelto, payload inválido, proveedor IA caído) |
| A3 | **Redis down** | Endpoint de cola no responde / error de conexión | Crítica | Seguir runbook §5.3 |
| A4 | **Quota de tokens** | `status = warning` (≥80 %) → aviso; `exceeded` (≥100 %) → crítico | Media/Alta | Avisar al tenant, revisar `bot_company_providers`, escalar o ajustar `bot_quota_daily_tokens` |
| A5 | **Errores LLM** | Tasa de `DependencyError` en proveedores > umbral en 5 min | Media | Revisar API keys, timeout, rate limit del proveedor, fallback del router |
| A6 | **Rate limit Meta (~80 msg/s)** | Respuestas `429`/`error` de la Cloud API en ventana | Alta | Aplicar backoff exponencial, revisar volumen, escalar WABA |
| A7 | **Firmas rechazadas** | `bot.webhook.signature.rejected` en 5 min | Crítica | Posible ataque o desincronización de `webhook_secret` — validar sin exponer secretos |
| A8 | **Handshake roto** | `bot.webhook.verify` (403) tras reconfiguración | Crítica | `verify_token` desincronizado con la WABA (ver runbook Fase C) |
| A9 | **Retención/privacidad** | Fallo en `purge_expired` / `erase` | Media | Verificar job de retención y permisos |

**Ejemplo de consulta de alerta (scrape del endpoint m2m):**
```bash
curl -s -H "Authorization: Bearer $OMNI2_SERVICE_CREDENTIAL" \
  "https://<host>/api/v1/bot/queue/stats?tenant_id=<tenant_uuid>"
# Alertar si .pending > 0  o  .dlq_count crece entre lecturas consecutivas
```

---

## §4 Dashboard unificado

Panel por **tenant** y **global**, con las métricas:

1. **Cola D3** — `length`, `pending`, `consumer_lag`, `dlq_count`, throughput
   (`enqueued`/`processed`/`failed` por minuto).
2. **Webhook** — contadores de `verified`, `signature.rejected`, `channel_unknown`,
   latencia p95 del `POST /webhook`.
3. **IA/LLM** — errores por proveedor, fallbacks del router, tiempo de respuesta.
4. **Quota** — `total_percent` por tenant con líneas de umbral 80 % y 100 %.
5. **Infraestructura** — Redis (memoria, conexiones, AOF), backend (HTTP 4xx/5xx,
   p95), PostgreSQL.
6. **WhatsApp** — volumen de mensajes, rate limit consumido vs ~80 msg/s.

El dashboard consume los endpoints de §2.1 (o métricas Prometheus si el operador
las instrumenta) y los logs JSON de §2.2.

---

## §5 Runbook de incidentes

### 5.1 Mensajes atascados (PEL creciente — alerta A1/A2)
1. `GET /bot/queue/stats` → confirmar `pending`/`consumer_lag`/`dlq_count`.
2. Revisar logs del worker: buscar `bot.queue.*` o errores de procesamiento.
3. Si el worker está detenido: **reiniciar el pool de workers**.
4. Si hay DLQ: revisar causa raíz; reencolar los mensajes válidos y corregir el
   defecto (sin parches).
5. Verificar en BD (`bot_messages` es la fuente de verdad): estados y
   `queue_status` de los mensajes afectados.

### 5.2 Proveedor IA caído (alerta A5)
1. Confirmar el error y el proveedor afectado (`bot.providers.*`).
2. El router debería **fallback al siguiente proveedor** o escalar a humano
   (diseño Fase 4). Verificar ese comportamiento en logs.
3. Restaurar el proveedor (API key, quota, red). No se requiere cambio de código.

### 5.3 Redis caído (alerta A3)
1. **No se pierde la fuente de verdad**: `bot_messages` en PostgreSQL persiste.
2. Levantar Redis y verificar AOF (ver §6).
3. Reencolar desde la BD los mensajes pendientes (la cola D3 usa la BD como
   fuente de verdad y Redis como cola viva).

### 5.4 Rate limit Meta (alerta A6)
1. Aplicar **backoff exponencial** en el sender (ver config de timeout/retry).
2. Reducir concurrencia del worker temporalmente.
3. Evaluar si el WABA requiere upgrade de capacidad o repartición multi-WABA.

---

## §6 Backup / restore de Redis + AOF

**Regla D3 del plan (§16):** Redis con **AOF habilitado** en producción; la BD
(`bot_messages`) es la **fuente de verdad** de los mensajes.

- **AOF**: `appendonly yes`; fsync `everysec` como balance durabilidad/rendimiento.
- **Backup periódico**: `BGSAVE` (snapshot RDB) + copia del archivo AOF; retener
  N días según política de retención del operador.
- **Restore**: cargar RDB/AOF de la última copia válida, arrancar Redis y **verificar
  integridad del stream** contra `bot_messages` (reencolar divergencias desde BD).
- **DR**: script de restore probado periódicamente (ejercicio de recuperación).

---

## §7 Cumplimiento (reglas CLAUDE)

- **Sin parches / sin hardcode**: las reglas y umbrales son configuración del
  operador; los datos vienen de endpoints existentes.
- **Fail-closed**: cualquier anomalía de firma/handshake se alerta como crítica,
  nunca se asume tráfico no verificado.
- **Fuente de verdad**: `bot_messages` (PostgreSQL) — Redis es cola viva
  reconstruible.
- **Auditoría estructurada**: todos los eventos monitoreados quedan en logs JSON.
- **Multi-tenant**: métricas por tenant (RLS); alertas con `tenant_id` explícito.

---

## §8 Estado del backlog

| Fase | Estado |
|------|--------|
| Fases 0–7, 9 | COMPLETADO ✅ |
| Fase C (cutover) | LISTO PARA EJECUTAR ✅ |
| **Fase O (este runbook)** | **DOCUMENTADO ✅** (operación en producción) |
| Fase 8 (multired) | Pendiente (opcional — ver [`fase-8-multired-diseno.md`](fase-8-multired-diseno.md)) |
| Validación productiva final | Pendiente (tras C y O) |
