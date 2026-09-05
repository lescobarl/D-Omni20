# Validación de la Fase 4 — Proveedores de IA del bot

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-27
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan §5.1)

> `providers/router.py` # ResponseProviderRouter: selección por empresa + fallback + caché
> `providers/local_provider.py` # Comportamiento actual de OmniBot_IA (reglas + content_items)
> `providers/llm_provider.py` # openrouter/deepseek: cliente OpenAI-compatible por empresa

**Entregado como:** subsistema `backend/app/bot/providers/` con dos proveedores
(`local` determinista que replica OmniBot_IA y `llm` OpenAI-compatible para
openrouter/deepseek) y un router `ResponseProviderRouter` que selecciona el
proveedor por empresa (orden + enable), hace *fallback* al siguiente ante fallo y
cachea respuestas con clave tenant-aware (SHA-256) — plan §7.1 y §7.2.

## 2. Entregables creados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/providers/__init__.py` | Re-exporta la API pública del subsistema (`IBotResponseCache`, `LocalResponseProvider`, `LlmResponseProvider`, `LruBotResponseCache`, `ResponseProviderRouter`, `build_response_provider_router`). |
| `backend/app/bot/providers/local_provider.py` | `LocalResponseProvider`: comportamiento actual de OmniBot_IA (reglas + `content_items`) — scoring de coincidencia, fallback por `kind` y escalación a humano con catálogo. |
| `backend/app/bot/providers/llm_provider.py` | `LlmResponseProvider`: cliente OpenAI-compatible por empresa (openrouter/deepseek) con grounding (`prompt_base` + contenido + catálogo), historial acotado e inyección de cliente `httpx`. |
| `backend/app/bot/providers/router.py` | `ResponseProviderRouter` + `LruBotResponseCache` (LRU + TTL thread-safe) + `build_response_provider_router()` (composition root). Selección por empresa, fallback, caché tenant-aware, escalación a humano ante fallo total. |
| `backend/tests/test_bot_providers.py` | 29 pruebas: 5 caché + 2 clave de caché + 5 local + 9 LLM + 8 router. |

## 3. Comportamiento validado

- **Selección por empresa**: `ResponseProviderRouter` ordena los `bot_company_providers`
  habilitados por `order` y los encadena (plan §7.1: el proveedor primario primero).
- **Fallback**: si un proveedor lanza cualquier excepción (timeout, 401, quota, shape
  inválido) el router registra `bot.provider.fallback` y prueba el siguiente de la cadena.
- **Caché tenant-aware**: la clave es `SHA-256(tenant_id | signature de proveedores |
  historial | mensaje)`; la firma incluye `provider_id`/`kind`/`model`/`prompt_base`
  para invalidar al cambiar la configuración. Solo se cachean respuestas que NO
  escalan a humano.
- **Fail-safe**: si ningún proveedor responde (cadena vacía o fallo total) el bot
  devuelve `needs_human=True` con mensaje de asesoría — nunca rompe el webhook
  (el router no propaga excepciones de proveedores).
- **Local (OmniBot_IA)**: coincidencia por título exacto, palabras en el mensaje,
  tags, saludo y tipo de menú; usa ítems `fallback/default` si no hay match y
  escala con hasta 5 ítems del catálogo formateados (SKU + precio Decimal).
- **LLM (openrouter/deepseek)**: `POST {base_url}/chat/completions` con
  `Authorization: Bearer <api_key>`, temperatura opcional (Decimal), historial
  filtrado por roles `user`/`assistant` (últimos 10 turnos) y tokens de uso. La
  falta de API key y los errores HTTP/parseo/forma lanzan `DependencyError` con
  etapa (`http`/`parse`/`shape`/`api_key_missing`) para permitir el fallback.
- **Ciclo de vida (DI)**: `close()` cierra el cliente solo si la instancia lo posee
  (nunca un cliente inyectado); el router cierra todos sus proveedores.

## 4. Resultados de pruebas

### Subset (proveedores del bot)

```
python -m pytest tests/test_bot_providers.py --no-cov
29 passed ✅
```

### Suite completa (con cobertura)

```
python -m pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=80
485 passed ✅  |  Total coverage: 95.15%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase 4

| Módulo | Cobertura |
| --- | --- |
| `app/bot/providers/router.py` | 98% |
| `app/bot/providers/llm_provider.py` | 96% |
| `app/bot/providers/local_provider.py` | 94% |

## 5. Cumplimiento CLAUDE

- **Regla DI / no `new`**: los proveedores reciben dependencias por constructor
  (`logger`, `client` opcional) y el router se compone vía
  `build_response_provider_router()`; el `CompanyContextBundle` llega completo
  (providers + `prompt_base` + `content_items` + `catalog_items`).
- **Multi-tenancy**: la caché es tenant-aware por construcción de clave; el router
  opera sobre el bundle de una empresa a la vez (context bundle Fase 3).
- **Sin hardcode**: `base_url`, `model`, `temperature`, `api_key`, `timeout`,
  `cache_ttl_seconds` y `default_model` son parámetros de la fábrica; el prompt de
  sistema por defecto solo se usa si `prompt_base` viene vacío.
- **Auditoría estructurada**: eventos `bot.provider.selected`, `bot.provider.fallback`,
  `bot.provider.failed`, `bot.provider.no_providers`, `bot.provider.cache_hit`,
  `bot.provider.local.match/fallback/escalation`, `bot.provider.llm.responded`
  (plan §7.1: la decisión se registra en auditoría).
- **Fail-safe en webhooks**: el router nunca propaga excepciones de proveedores;
  ante fallo total devuelve una respuesta `needs_human` (plan §7.1 fail-safe).
