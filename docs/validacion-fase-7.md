# Validación de la Fase 7 — Frontend Bots/Conversaciones (sección + flag + monitor de cola)

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-28
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan — Fase 7)

> `frontend/src/components/Settings/BotsSection.tsx` # Sección Bots/Conversaciones (config IA por empresa)
> `frontend/src/components/Settings/TenantConfigSettings.tsx` # 5ª pestaña "Bots / Conversaciones" (aria-controls)
> `frontend/src/store/botStore.ts`                    # Estado zustand: providers, conversaciones, mensajes, cola
> `frontend/src/services/botService.ts`               # Puerto `IBotService` + `BackendBotService` + factory
> `frontend/src/api/client.ts` + `api/types.ts`       # Puerto `IApiClient` (7 métodos bot) + DTOs snake_case
> `frontend/src/lib/config.ts`                        # Flag fail-closed `VITE_FEATURE_BOTS` → `config.bots`
> `frontend/src/test/apiClientMocks.ts` + `botMocks.ts` # Fábricas de mocks compartidas (DRY, 49 métodos)
> `frontend/e2e/bots.spec.ts`                         # 2 pruebas E2E (cabecera 5 pestañas + ciclo de vida provider)

**Entregado como:** la sección **Bots/Conversaciones** del configurador del tenant que cierra el viaje
"traer a OmniBotIA al core" por el lado del cliente: configuración de proveedores de IA por empresa
(alta/baja/edición y estado habilitado), visor de conversaciones con su historial de mensajes, envío
manual de prueba y monitor de la cola D3, todo protegido por el flag `VITE_FEATURE_BOTS` (fail-closed,
deshabilitado por defecto). El backend de bot (Fases 3-6.1) ya estaba completo y validado; esta fase
añade el frontend que lo opera, siguiendo el patrón de capas del resto del proyecto:

`api/types.ts` (DTOs) → `api/client.ts` (puerto + `HttpApiClient`) → `services/botService.ts`
(puerto + `BackendBotService`) → `store/botStore.ts` (zustand + DI + status) → `BotsSection.tsx`
(UI accesible) → pestaña en `TenantConfigSettings.tsx` → wiring en `main.tsx`.

## 2. Entregables creados / modificados

| Archivo | Responsabilidad |
| --- | --- |
| `frontend/src/api/types.ts` | DTOs bot snake_case: `IQueueStatsRead`, `IConversationRead`, `IMessageRead`, `IBotProviderConfigRead`, `IBotProviderUpsert`, `IMessageCreate`, `IMessageEnqueueResult` (líneas 849-966). |
| `frontend/src/api/client.ts` | Constantes `API_PATHS.bot*` + 7 métodos del puerto `IApiClient` e impl `HttpApiClient`: `listConversations`, `listConversationMessages`, `sendConversationMessage`, `listBotProviders`, `upsertBotProvider`, `deleteBotProvider(providerKind, order)` (clave compuesta), `getBotQueueStats`. |
| `frontend/src/services/botService.ts` | Puerto `IBotService` (7 métodos camelCase) + `BackendBotService` + factory `createBotService(apiClient, logger?)`; `deleteProvider` delega la clave compuesta tipo/orden. |
| `frontend/src/store/botStore.ts` | Estado zustand `IBotState`: `providers`, `conversations`, `messages`, `queueStats`, `*Status`, `extractErrorMessage`, servicio inyectado (`setBotService`/`getBotService` con guard service-null) y `reset()`. |
| `frontend/src/components/Settings/BotsSection.tsx` | Sección accesible (`aria-labelledby="bots-heading"`): formulario de provider (tipo obligatorio 1-16, orden ≥ 0, modelo/temperatura/prompt_base opcionales), lista con estado, toggle habilitar, eliminar; visor de conversaciones + mensajes; envío manual (202 encolado); monitor de cola D3. |
| `frontend/src/components/Settings/TenantConfigSettings.tsx` | 5ª pestaña "Bots / Conversaciones" con `aria-controls`/`aria-labelledby`; árbol accesible oculta los paneles inactivos. |
| `frontend/src/main.tsx` | Wiring del store/servicio y render condicional por `config.bots` (flag fail-closed). |
| `frontend/src/lib/config.ts` | `VITE_FEATURE_BOTS` → `config.bots` (por defecto `false`); definido en `IFeatureFlags`. |
| `frontend/src/test/apiClientMocks.ts` | Fábrica compartida `makeApiClientMock(): IApiClient` con los **49 métodos** del puerto como `vi.fn()`; migrados 9 archivos de test de servicios (DRY, una sola fuente de verdad). |
| `frontend/src/test/botMocks.ts` | `makeProvider/makeConversation/makeMessage/makeQueueStats/makeMessageEnqueueResult/makeService` para pruebas de store y sección. |
| `frontend/e2e/bots.spec.ts` | 2 pruebas E2E: (1) cabecera con 5 pestañas y sección Bots accesible; (2) crea → deshabilita → elimina un proveedor de IA por la UI (clave compuesta). |

## 3. Comportamiento validado

- **Config de IA por empresa**: listar proveedores (`GET /bot/providers`); crear o reemplazar por clave
  compuesta (`PUT /bot/providers`); validación de tipo obligatorio (1-16 caracteres) y de orden como
  entero ≥ 0; opcionales `model`/`temperature`/`prompt_base` normalizados a `null` cuando no se proveen;
  alternar `enabled` (deshabilitar sin borrar); **eliminar** por `(provider_kind, order)` con
  `DELETE /bot/providers/{provider_kind}/{order}` (204) y filtro local por la misma clave de negocio.
- **Visor de conversaciones y mensajes**: listar conversaciones paginadas (`GET /bot/conversations`);
  seleccionar una conversación → cargar su historial (`GET /bot/conversations/{id}/messages`) y marcarla
  como activa; estados de carga/vacío/error accesibles.
- **Envío manual de prueba**: validación de mensaje no vacío; `POST /bot/conversations/{id}/messages`
  devuelve 202 `MessageEnqueueResult`; tras el envío se refrescan mensajes y conversaciones.
- **Monitor de cola D3**: `GET /bot/queue/tenant-stats` → `IQueueStatsRead` renderizado en la sección;
  estado vacío cuando no hay estadísticas y métricas con gráfica D3.
- **Flag fail-closed**: con `VITE_FEATURE_BOTS` ausente/`false`, la sección no se monta (sin fuga de UI
  ni de llamadas de red).
- **Accesibilidad**: pestañas con `aria-controls`/`aria-labelledby` y sección con encabezado accesible;
  los mensajes de error de carga se exponen de forma accesible.
- **Integración end-to-end** (`e2e/bots.spec.ts`): la cabecera muestra las 5 pestañas con la sección
  Bots accesible; un proveedor se crea, se deshabilita y se elimina por la UI — el borrado apunta ahora a
  la ruta real del backend de clave compuesta (ver §4.2).

## 4. Mejoras de causa raíz (sin parches)

### 4.1 Refactor de mocks duplicados → fábrica compartida (tests, DRY)

**Síntoma:** 9 archivos de test de servicios (`*Service.test.ts`) repetían bloques casi idénticos de
mocks manuales del `IApiClient` (~42 métodos base + 7 de bot); cualquier cambio de contrato exigía
editar 9 sitios y el patrón fomentaba mocks incompletos.

**Causa raíz:** no existía una única fuente de verdad para el doble del puerto del cliente.

**Solución:** crear `frontend/src/test/apiClientMocks.ts` con `makeApiClientMock()` que construye los
**49 métodos** del puerto como `vi.fn()`; migrar los 9 servicios a usarla (inyectando solo los
overrides que cada prueba necesita). Un solo lugar a mantener, imposible que un método quede sin mock.

### 4.2 Eliminación de proveedor apuntaba a ruta inexistente (bug de integración real)

**Síntoma:** la UI borraba un proveedor con `DELETE /bot/providers/{providerId}` (un segmento, UUID
sustituto), pero el backend expone `DELETE /bot/providers/{provider_kind}/{order}` (**dos** segmentos,
clave de negocio `(provider_kind, order)` definida en `bot.py:450`). Un borrado real desde la UI
habría devuelto `404 Not Found` porque la ruta de un segmento no existe.

**Causa raíz:** el frontend usaba el identificador sustituto `provider.id` (UUID) para borrar, ignorando
que el backend identifica los proveedores por su **clave de negocio compuesta**.

**Solución (cadena completa, sin parches):**
- `client.deleteBotProvider(providerKind: string, order: number)` → `DELETE /bot/providers/{encodeURIComponent(providerKind)}/{order}`.
- `botService.deleteProvider(providerKind, order)` delega la clave compuesta.
- `botStore.deleteProvider(providerKind, order)` filtra la colección local por
  `provider_kind !== providerKind || order !== order` (clave de negocio, no UUID).
- `BotsSection.handleDeleteProvider` deriva la clave del propio objeto `IBotProviderConfigRead`
  (`provider.provider_kind`, `provider.order`) — sin hardcode.
- Los 4 archivos de test (cliente/servicio/store/sección) se actualizaron a la clave compuesta.

**Cobertura de la ruta corregida:** `client.test.ts` verifica el `DELETE` contra
`http://localhost:8000/api/v1/bot/providers/openai/0` con la cabecera `X-Tenant-Id`; `BotsSection.test.tsx`
verifica que la sección llama `deleteProvider('openai', 0)`; `e2e/bots.spec.ts` recorre el alta/borrado
por la UI contra el backend real.

## 5. Resultados de pruebas

### Frontend — Fase 7 (subconjunto bot)

```
npm test -- --run (55 archivos / 582 pruebas)
  ✓ BotsSection.test.tsx        14 pruebas  (validación, alta, lista, toggle, borrado clave compuesta, mensajes, cola)
  ✓ botStore.test.ts            30 pruebas  (providers, conversaciones, mensajes, envío, monitor, reset)
  ✓ botService.test.ts          18 pruebas  (delegación DTO, normalización nulos, borrado clave compuesta)
  ✓ client.test.ts              7  pruebas bot (GET/POST/PUT/DELETE /bot/* + tenant-stats)
  ✓ TenantConfigSettings.test.tsx 5 pruebas (5 pestañas, aria-controls, encabezado)
  ✓ apiClientMocks / botMocks / e2e/bots.spec.ts (2 E2E)

npm run build
  tsc + vite build → EXIT 0 (839 módulos, 9.36 s; única advertencia no fatal: chunk Monaco 2,667 kB)

npm run validate
  validate:hardcode ✅  |  validate:trycatch ✅  |  validate:jsdoc ✅  (85 archivos cada uno)
  validate:format ✅    |  "All matched files use Prettier code style!"
```

### Backend — bot (Fases 3-6.1, base de esta fase)

```
python -m pytest -q
628 passed ✅  |  Total coverage: 94.55%  |  Gate 80% superado ✅
  (incluye test_api_bot, test_bot_api_tenant, test_bot_conversation, test_bot_providers,
   test_bot_queue, test_bot_queue_redis, test_bot_channel_factory, test_bot_channels,
   test_bot_context_bundle, test_bot_company_context, test_bot_models, test_bot_migration)
```

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new`**: el frontend mantiene el patrón de capas por puertos (`IApiClient` →
  `IBotService` → `IBotState`); el store inyecta el servicio (`setBotService`/`getBotService`) y degrada
  con un guard service-null; las fábricas `createBotService`/`makeApiClientMock` componen sin `new`.
- **Sin hardcode**: claves de ruta derivadas del objeto de dominio (`provider.provider_kind`,
  `provider.order`); la URL base viene de la configuración; los nombres de tipo/orden son datos, no
  constantes embebidas en la UI.
- **Fail-closed**: flag `VITE_FEATURE_BOTS` deshabilitado por defecto; sin flag no se monta la sección
  ni se disparan llamadas de red.
- **Estructura y validación**: sección accesible (ARIA), mensajes de error visibles, estados
  loading/vacío/error cubiertos; `npm run build` (tsc), `npm run validate` y `npm test` en verde.
- **Multi-tenancy / RLS**: toda llamada sale con la cabecera `X-Tenant-Id` del cliente; el backend
  (ya validado) aplica RLS por tenant sobre conversaciones/mensajes/providers/cola.

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
| **Fase 7 — Frontend Bots/Conversaciones** | **COMPLETADO ✅** |
| Fase C — Cutover del webhook | Pendiente |
| Fase 9 — Config, tests y validación (9a M4 / 9b L1) | Pendiente |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
