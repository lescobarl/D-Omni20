# Validación — Dominios personalizados (PSEO hosts)

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-30
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan — Dominios personalizados)

> `backend/app/api/v1/pseo_hosts.py`          # Router CRUD de dominios personalizados del tenant
> `backend/app/services/pseo_host_service.py` # `PseoHostService`: request/verify/remove + `_normalize_host`
> `backend/app/schemas/pseo.py`               # `PseoHostRequest` (validator), `PseoHostRead`, `PseoBatchRead`
> `backend/app/api/deps.py`                   # Providers DI: `get_pseo_host_repository`, `get_pseo_host_service`, `get_pseo_tenant_by_host`
> `backend/migrations/...`                    # Tabla `pseo_hosts` (host, tenant_id, status, verify_token, soft-delete)
> `backend/tests/test_pseo_hosts.py`          # 19 pruebas del feature (request/verify/list/remove/serving/isolation)
> `backend/tests/test_pseo.py`                # 17 pruebas del serving público PSEO por `Host`
> `frontend/src/components/Dominios/DominiosSection.tsx` # Vista "Dominios" (solicitar/verificar/eliminar)
> `frontend/src/services/hostsService.ts`     # Puerto `IPseoHostService` + `BackendPseoHostService` + fábrica
> `frontend/src/store/hostsStore.ts`          # `useHostsStore` (zustand) del feature
> `frontend/src/api/types.ts` + `client.ts`   # `IPseoHostRequest`/`IPseoHostRead` + 4 métodos del cliente
> `frontend/src/lib/config.ts` + `types/config.ts` # Feature flag `features.hosts` (fail-closed)
> `frontend/.prettierrc.json`                 # `"endOfLine": "auto"` (fix de la puerta `validate:format`)

**Entregado como:** la vista **"Dominios"** del panel de control (control plane) que permite a cada
cliente/tenant registrar un dominio propio, verificar su titularidad mediante un registro DNS TXT
(`_omni2-verify.{host}`) y activarlo para que el **serving público PSEO** lo resuelva por el encabezado
`Host`. Todo sobre el stack ya validado: repositorios por puertos inyectados vía DI (regla CLAUDE),
RLS/aislamiento por tenant, soft-delete, feature flags fail-closed y logging estructurado. El registro
pendiente **no** se sirve (404); solo el activo se sirve y alimenta el sitemap canónico.

## 2. Entregables creados / modificados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/api/v1/pseo_hosts.py` | Router del tenant: `GET ""` (lista plana), `POST ""` (201), `POST "/{host_id}/verify"`, `DELETE "/{host_id}"` (204). Todos resuelven el tenant vía `get_current_tenant`. |
| `backend/app/services/pseo_host_service.py` | `PseoHostService.request_domain` (normaliza, valida duplicados por tenant, genera `verify_token`, crea `pending`), `verify_domain` (verificación DNS `IDnsVerifier`, `pending`→`active`, idempotente), `remove_domain` (soft-delete). |
| `backend/app/schemas/pseo.py` | `PseoHostRequest.host` con `field_validator` (normalización y formato), `PseoHostRead` (con `verify_token` y `status`), `PseoBatchRead` reutilizado por el serving. |
| `backend/app/api/deps.py` | Providers DI: `get_pseo_host_repository` (316-320), `get_pseo_host_service` (355-375, compone el servicio con `IDnsVerifier`), `get_pseo_tenant_by_host` (596-638, resolución del tenant por `Host` para el serving público). |
| `backend/migrations/...` | Tabla `pseo_hosts`: `id`, `tenant_id`, `host`, `status` (pending/active), `verify_token`, `deleted_at` (soft-delete) + seed de host de desarrollo activo. |
| `backend/tests/test_pseo_hosts.py` | 19 pruebas: `TestRequestHost` (5), `TestVerifyHost` (4), `TestListAndRemove` (6), `TestPublicServingGuard` (3), `TestRepoIsolation` (3) — ver §5. |
| `backend/tests/test_pseo.py` | 17 pruebas del serving público: resolución por `Host`, sitemap paginado, `TestServePage`, aislamiento entre tenants. |
| `frontend/src/components/Dominios/DominiosSection.tsx` | Vista del feature: carga la lista al montar, formulario de solicitud con validación ("El dominio es obligatorio."), recuadro de verificación DNS TXT para `pending`, badges `Activo`/`Pendiente`, botones `Verificar` (solo `pending`) y `Eliminar`, `role="status"`/`aria-live` accesibles. |
| `frontend/src/services/hostsService.ts` | Puerto `IPseoHostService` (`listPseoHosts`, `requestPseoHost`, `verifyPseoHost`, `deletePseoHost`), `IPseoHostInput { host }`, `BackendPseoHostService implements IPseoHostService` vía `IApiClient`, fábrica `createPseoHostService`. `listPseoHosts` devuelve `IPseoHostRead[]` directo (backend entrega lista plana, no paginada). |
| `frontend/src/store/hostsStore.ts` | `useHostsStore` (zustand): estado `hosts/hostsStatus/hostsError` + acciones `listPseoHosts/requestPseoHost/verifyPseoHost/deletePseoHost/reset`, con `extractErrorMessage` y degradación a error sin servicio. |
| `frontend/src/api/types.ts` + `client.ts` | `IPseoHostRequest` (1332-1335) y `IPseoHostRead` (1344-1365); métodos `listPseoHosts`/`requestPseoHost`/`verifyPseoHost`/`deletePseoHost` (1336-1362). |
| `frontend/src/lib/config.ts` + `types/config.ts` | Feature flag `features.hosts` parseado desde `VITE_FEATURE_HOSTS`, **desactivado por defecto** (fail-closed). |
| `frontend/src/App.tsx` | Cableado: `hostsEnabled = config.features.hosts` (51), `toggleHosts` (65-67), botón de cabecera `Dominios`/`Volver al editor` con `aria-pressed` (105-114), subtítulo `Dominios personalizados` (130-132), `{view === 'hosts' ? <DominiosSection /> : …}` (152-153) con el union `AppView`. |
| `frontend/.prettierrc.json` | `"endOfLine": "auto"` — preserva el EOL por archivo y desbloquea la puerta `validate:format` (ver §4.1). |
| `frontend/src/components/Dominios/DominiosSection.test.tsx` | 7 pruebas de UI (flujo vacío + verificación DNS, validación, registro, listado, verificación/activación, eliminación, error accesible). |
| `frontend/src/services/hostsService.test.ts` + `src/store/hostsStore.test.ts` | 16 pruebas de servicio y store (delegación al cliente, degradación a error, propagación de mensajes, reset). |
| `frontend/src/lib/config.test.ts` | 11 pruebas de config, incluida "mantiene el flag de dominios personalizados desactivado por defecto (fail-closed)". |

## 3. Comportamiento validado

### Ciclo de vida del dominio (control plane)

- **Solicitud** (`POST /pseo/hosts` → 201): el tenant envía `{ "host": "portal.miempresa.com" }`; el
  servicio normaliza el host (`_normalize_host`: minúsculas, sin esquema/path, sin barra final),
  valida el formato, rechaza duplicados del mismo tenant (409) y de otros tenants (409, aislamiento),
  genera un `verify_token` y crea el registro en estado `pending`. Host inválido → 422.
- **Verificación DNS** (`POST /pseo/hosts/{host_id}/verify`): la UI muestra las instrucciones exactas —
  registro TXT **`_omni2-verify.{host}`** con valor `verify_token` (además de la pista de CNAME
  `clientes.omni2.app`). Al verificar, `PseoHostService` consulta `IDnsVerifier`; al confirmar el
  registro, `pending` → `active`. Verificar un host ya activo es idempotente (200 sin cambios).
- **Listado** (`GET /pseo/hosts`): devuelve **solo** los hosts del tenant autenticado (lista plana, sin
  paginación) con `status` y `verify_token` para el recuadro de verificación.
- **Eliminación** (`DELETE /pseo/hosts/{host_id}` → 204): **soft-delete** (marca `deleted_at`, no borra
  físicamente). El test verifica que el host eliminado deja de servirse y que volver a solicitarlo
  ("remove + requeue") reactiva el registro como `pending`. Host de otro tenant o inexistente → 404.

### Serving público (PSEO)

- **Pending NO se sirve**: un `Host` con `status = pending` responde **404** (guard de `TestPublicServingGuard`).
- **Active SÍ se sirve**: el `Host` activo resuelve el tenant vía `get_pseo_tenant_by_host` y sirve la
  landing compilada del tenant, alimentando también el sitemap canónico (paginado).
- **Aislamiento**: `test_cross_tenant_access_denied` confirma que un host de otro tenant no se sirve ni
  se administra desde otro tenant (404/409 según la operación).
- **Seed de desarrollo**: el host de desarrollo sembrado en la migración nace `active` (la UI y el
  serving lo ven listo sin verificación).

### Frontend (vista "Dominios")

- **Cableado por flag**: la sección solo aparece si `config.features.hosts` es `true` (fail-closed;
  por defecto `false`). El botón de cabecera alterna `Dominios`/`Volver al editor` con `aria-pressed`.
- **Carga inicial**: `useEffect(() => { void listPseoHosts(); }, [listPseoHosts])` con estados
  `Cargando dominios personalizados…`, lista vacía (`Aún no hay dominios personalizados.`) y error
  accesible (`role="status"` + `aria-live`).
- **Validación local**: `if (host.trim() === '') { setFormError('El dominio es obligatorio.'); return; }`
  antes de llamar al servicio; el error se anuncia vía `aria-live="polite"`.
- **Accesibilidad**: encabezado con `aria-labelledby`, `fieldset`, badges con texto (`Activo` emerald /
  `Pendiente` amber), y los mensajes de estado/error en regiones `role="status"`/`aria-live`.

## 4. Mejoras de causa raíz (sin parches)

### 4.1 Puerta `validate:format` — preservación de EOL por archivo

**Síntoma:** `npm run validate` fallaba en `validate:format` (prettier) sobre 50 archivos del alcance
`src/**/*.{ts,tsx}`: 17 solo por EOL (CRLF↔LF) y 33 con diferencias reales (deuda preexistente, no del
feature).

**Causa raíz:** la config prettier no definía `endOfLine`; el motor asumía el EOL del host, y la
coexistencia de archivos LF (heredados) y CRLF (Windows) hacía que `prettier --check` marcara los que
no coincidían, sin que hubiera un problema de estilo real.

**Solución:** se agregó `"endOfLine": "auto"` a `.prettierrc.json` y se ejecutó `prettier --write` sobre
el alcance. Resultado: `validate:format` **verde** ("All matched files use Prettier code style!") sin
convertir masivamente CRLF→LF. Se verificó empíricamente la integridad de EOL: los archivos LF siguen
100 % LF (types.ts 1978, client.ts 1659, config.ts 261, types/config.ts 89) y los CRLF siguen 100 %
CRLF sin LF suelto (DominiosSection.tsx 215, hostsStore.ts 177, hostsService.ts 80, hostsMocks.ts 44,
adsStore/adsService/AdsSection y todos los `ui/*`). `npx tsc --noEmit` quedó limpio y la suite vitest
(877 pruebas) siguió verde tras el reformateo.

### 4.2 Validación de cobertura por suite completa (metodología)

**Síntoma:** ejecutar solo `tests/test_pseo_hosts.py tests/test_pseo.py` imprime 36 puntos (todo
pasó) pero sale con código 1: `FAIL Required test coverage of 80% not reached. Total coverage: 54.45%`,
lo que podría interpretarse como un defecto.

**Causa raíz:** el gate `--cov-fail-under=80` de `pyproject.toml` se evalúa sobre **todo** el paquete
`app`; un subconjunto de archivos solo cubre el 54.45 % y no puede satisfacerlo por diseño.

**Solución:** validar con la **suite completa** (autoritativa). Resultado: **953 pruebas, cobertura
total 95.26 %** (≥ 80 ✅). Se documenta en §5 para que la operación valide siempre con
`python -m pytest` sin filtro de archivo.

### 4.3 Contrato de listado no paginado

**Síntoma/oportunidad:** `GET /pseo/hosts` devuelve una **lista plana** (no `IPage`), a diferencia de
otros recursos del panel.

**Causa raíz/solución:** se respetó el contrato real del backend en el puerto: `listPseoHosts` devuelve
`IPseoHostRead[]` directamente (sin `IPageQuery`), con la nota documentada en el JSDoc de
`hostsService.ts` para evitar que un futuro cambio lo "convierta" a paginado sin revisar el backend.

## 5. Resultados de pruebas

### Backend — suite completa (autoritativa para el gate 80 %)

```
.venv\Scripts\python.exe -m pytest
953 passed ✅  |  Total coverage: 95.26 %  |  Gate 80 % superado ✅  |  EXIT 0
```

### Backend — feature Dominios personalizados (36 pruebas)

```
.venv\Scripts\python.exe -m pytest tests/test_pseo_hosts.py tests/test_pseo.py -q
36 dots (todo verde) — el subconjunto NO satisface el gate 80 % por diseño (54.45 %); ver §4.2.
```

- `tests/test_pseo_hosts.py` (19): `TestRequestHost` 5 (crea pending, normaliza, duplicado mismo
  tenant 409, duplicado otro tenant 409, inválido 422) · `TestVerifyHost` 4 (pending→active,
  idempotente, 404 inexistente, 404 otro tenant) · `TestListAndRemove` 6 (lista solo lo propio,
  soft-delete, 404 otro tenant, 404 inexistente, remove+requeue reactiva) · `TestPublicServingGuard` 3
  (pending no se sirve 404, active sirve + alimenta canónico) · `TestRepoIsolation` 3 (seed dev activo,
  acceso cross-tenant denegado).
- `tests/test_pseo.py` (17): serving público por `Host`, sitemap paginado, `TestServePage` y
  aislamiento entre tenants.

> **Nota metodológica:** el subconjunto aislado reporta cobertura parcial (54.45 % < 80 %) y falla el
> gate; esto es esperado por diseño — la validación correcta es la suite completa (§4.2).

### Frontend — gates de calidad y tipos

```
npm run validate
  validate:hardcode ✅ (124 archivos)   validate:trycatch ✅ (124 archivos)
  validate:jsdoc    ✅ (124 archivos)   validate:format   ✅ ("All matched files use Prettier code style!")

npx tsc --noEmit
  sin errores ✅ (EXIT 0)
```

### Frontend — suite completa

```
npx vitest run
82 archivos de test / 877 pruebas passed ✅ (EXIT 0)
  (solo warnings `act()` preexistentes en BotsSection.test.tsx e InterventionsSection.test.tsx, ajenos al feature)
```

### Frontend — feature Dominios personalizados (4 archivos / 34 pruebas)

```
npx vitest run src/components/Dominios/DominiosSection.test.tsx src/services/hostsService.test.ts src/store/hostsStore.test.ts src/lib/config.test.ts
34 passed ✅
  DominiosSection.test.tsx 7  ·  hostsService.test.ts + hostsStore.test.ts 16  ·  config.test.ts 11
  (incluye "mantiene el flag de dominios personalizados desactivado por defecto (fail-closed)")
```

## 6. Cumplimiento CLAUDE

- **Regla DI / no `new` en componentes**: `DominiosSection` consume `useHostsStore` (sin instanciar
  servicios); `BackendPseoHostService` se compone en `createPseoHostService(apiClient, logger)` y el
  backend expone `get_pseo_host_repository`/`get_pseo_host_service` (con `IDnsVerifier` inyectado) en
  `deps.py` — sin `new` en el caso de uso.
- **Puertos como interfaces**: `IPseoHostService` (frontend) e `IPseoHostRepository`/`IPseoHostService`
  (backend) definen los contratos; las implementaciones concretas los implementan y se resuelven por
  fábricas desde el composition root.
- **Soft-delete**: `remove_domain`/`DELETE` marca `deleted_at`; no hay borrado físico del dominio, y el
  re-solicitado reactiva el registro.
- **Fail-closed**: el flag `features.hosts` es `false` por defecto (config + test dedicado); un host
  `pending` no se sirve (404) hasta verificar; sin `X-Tenant-Id`/`Host` válido el backend rechaza.
- **Multi-tenancy / RLS**: cada operación filtra por `tenant_id` (control plane vía `X-Tenant-Id`,
  serving público vía `get_pseo_tenant_by_host`); cross-tenant verificado con 404/409.
- **Configuración, no hardcode**: la verificación DNS usa el verifier inyectado; hosts semilla en la
  migración; EOL en `.prettierrc.json` sin convertir archivos.
- **Estructura y validación**: 36 pruebas backend + 34 frontend + suite completa verde (953 backend /
  877 frontend, cobertura 95.26 %); sin parches ni valores mágicos.

## 7. Estado del backlog

| Ítem | Estado |
| --- | --- |
| Fase M — Migración | COMPLETADO ✅ |
| Fases 3-9 (prov. IA, WhatsApp, cola, conversación, bots, gobernanza) | COMPLETADO ✅ |
| Fase C — Cutover / go-live del webhook (runbook) | Pendiente |
| Fase O — Monitoreo y alertas operacional | Pendiente (paralela a C) |
| Fase 8 — Multired (SMS/Instagram/Messenger/webchat) | Pendiente (opcional) |
| **Dominios personalizados (PSEO hosts) — vista "Dominios"** | **COMPLETADO ✅** |
