> **ARCHIVO HISTÓRICO — SUPERSEDED (v3.5).** Reemplazado por `AGENTS.md` (v6.0, raíz
> del repo). **NO usar como fuente de reglas**; se conserva solo como registro.
> Fuente canónica única: `omnibotia-studio/AGENTS.md`.

# Reglas Absolutas de Ingeniería

> Este archivo es vinculante. El agente DEBE leer y cumplir todas las reglas aquí definidas antes de cualquier operación.
> Este es el ÚNICO archivo de constraints. No existen archivos duplicados.

---

## 1. PROHIBICIONES ABSOLUTAS

| # | Regla | Descripción |
|---|-------|-------------|
| 0 |NO! notificar hasta tener 100% validado| se debe notificar la conclusion de una tarea hasta que este 100% validada , con prubas productivas|
| 0.0 | ⏳ NO timeout:null en comandos | Prohibido usar `timeout: null` en `execute_command`. Todo comando debe tener un timeout finito (máx. 30s para comandos rápidos, máx. 120s para instalaciones). Para servidores largos (vite, npm start, flutter run, etc.), usar timeout de 15-30s solo para verificar arranque y luego verificar con otro comando. El uso de `timeout: null` causa el botón "Run" y bloquea el chat. |
| 0.1 |Integra en tus validaciones screenshot para que certifiques que todo esta bien!|
| 0.2 |No esta permitido genracion de objetos dummy todo debe ser perfectamente funional|
| 0.3 |Las validaciones y pruebas deben incluir auditorias visuales , funcionales y tecnicas completas asegurando funcionalidad y visualizacion completa|
| 1 | ❌ NO ENTREGAS PARCIALES O SIN VALIDAR | Cada tarea resuelta debe estar completa , validada tanto funcional como visualmente  |
| 1 | ❌ NO HARDCODE | Toda configuración debe venir de variables de entorno, archivos de configuración o inyección de dependencias. Prohibido escribir valores quemados en el código. |
| 2 | ❌ NO PARCHES | Si se detecta un error, se debe corregir de fondo. No se permiten parches de código para casos de borde. Cero soluciones temporales. |
| 3 | ❌ NO `new` en lógica de negocio | Prohibida la instanciación directa de clases con operador `new` dentro de la lógica de negocio. Toda dependencia debe inyectarse mediante interfaces. |
| 4 | ❌ NO commits directos a `main`/`master` | El flujo de desarrollo exige ramas de características aisladas (`feature/*`). Prohibido commitear directo a producción. |
| 5 | ❌ NO try-catch vacíos | No se permiten bloques try-catch vacíos o que silencien errores. Toda excepción debe ser capturada, registrada en el log de auditoría y propagada con contexto descriptivo. |
| 6 | ❌ NO modificar +2 archivos de dominio sin interfaz común | Si una tarea requiere modificar más de dos archivos de dominio distintos, el agente debe proponer primero un diseño de interfaz común antes de implementar. |
| 7 | ❌ NO cambios temporales o rutas dobles | Cualquier cambio debe ser realizado de fondo. No se permiten archivos duplicados para prueba, comentarios de código legacy, ni implementaciones paralelas. |
| 8 | ❌ NO borrado físico en offline | El borrado es estrictamente lógico (`deleted: true`), nunca físico en offline. |
| 9 | ❌ NO a entregas parciales, todo se debe entregar completo de acuerdo a la solicitud |
| 10 | ❌ NO a grandes respuestas, solo cualdo se solicita el detalle responder detalladamente, de modo contrario responder en resumen lo mas claro y preciso posible |
| 11 | ❌ NO casos de prueba arbitrarios ni duplicados | Prohibido crear casos de prueba de manera arbitraria o duplicados. Cada test debe cubrir un caso real y único definido por la especificación; no se duplican coberturas ni se inventan pruebas sin sustento. |
| 12 | ❌ NO rutas dobles | Prohibido crear rutas duplicadas o en paralelo para el mismo recurso/acción. Una sola ruta canónica por endpoint; cualquier duplicado debe eliminarse. |
| 13 | ❌ NO parches | Prohibido aplicar parches o soluciones temporales. Todo error se corrige de fondo en su causa raíz. (Refuerza la regla 2.) |
| 14 | ❌ NO basura en el proyecto | El proyecto se depura DIARIAMENTE, tanto en código como en archivos: sin duplicados, sin archivos inútiles, sin código obsoleto o muerto. Todo lo que no se use o esté obsoleto se elimina. |
| 15 | ❌ NO disculpas; consistencia total | Las disculpas son inaceptables. Todo entregable debe ser consistente con las definiciones y especificaciones del proyecto. Si algo no cumple, se corrige, no se justifica. |
| 16 | ❌ NO errores de programación/lógica/implementación | Los errores de programación, lógica o implementación son inaceptables. Todo código debe ser correcto, validado y sin defectos antes de notificar conclusión. |
| 17 | ❌ NO declarar "funciona"/"puedes entrar" validando solo con TestClient | `TestClient` (in-memory `http://testserver`) NO valida contra el servidor real ni su DB. Para afirmar que algo funciona en vivo, validar SIEMPRE contra el backend real corriendo (`http://127.0.0.1:8000`, nunca `localhost` que puede resolver a IPv6 `::1`) y contra la DB real que usa el proceso. |
| 18 | ❌ NO ignorar el estado "vivo pero inaccesible" del backend en Windows | Por el bug del event loop (IocpProactor), el backend puede quedar con el puerto en LISTENING pero sin responder HTTP (curl → HTTP 000). Si el puerto está ocupado pero no responde, matar el proceso zombie (`taskkill /PID <pid> /F`) y reiniciar con `python run_dev.py` (fuerza `WindowsSelectorEventLoopPolicy`). |

## 2. OBLIGACIONES ESTRICTAS

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | ✅ Inyección de Dependencias | Toda dependencia debe ser inyectada mediante interfaces. Prohibida la instanciación directa. Garantiza desacoplación total y testabilidad. |
| 2 | ✅ JSDoc en todo componente/método | Todo nuevo componente o método debe incluir comentarios JSDoc que expliquen el contrato de la interfaz, no la implementación interna. |
| 3 | ✅ Principio de Responsabilidad Única (SRP) | Cada archivo/clase debe tener una única razón para cambiar. |
| 4 | ✅ Tests de inmutabilidad | Toda pieza desarrollada debe incluir un test que valide que la arquitectura sigue siendo agnóstica al negocio tras los cambios. |
| 5 | ✅ Log de auditoría | Todo cambio en configuración debe ser registrado en un log inmutable de auditoría. |
| 6 | ✅ UUIDv4 en toda inserción | Queda estrictamente prohibido el uso de llaves numéricas secuenciales. Toda inserción genera UUIDv4 en texto plano. |
| 7 | ✅ Tupla de sincronización obligatoria | Cada tabla incorpora obligatoriamente `[revision, updated_at, deleted]`. Las modificaciones incrementan `revision` atómicamente y actualizan `updated_at` en UTC. |
| 8 | ✅ Gestión de errores con contexto | Toda excepción debe ser capturada, registrada en el log de auditoría y propagada con un contexto descriptivo. |
| 9 | ✅ Aislamiento de contexto de IA | Cada llamada de inferencia debe inicializar un contexto ciego aislado. Purgar variables globales residuales antes de cada inferencia. |
| 10 | ✅ Circular Buffer en audio | El pipeline de audio debe implementar vaciado cíclico cada 30 segundos para evitar fugas de memoria. |
| 11 | ✅ requestAnimationFrame para 3D | El renderizado 3D debe aislarse con `requestAnimationFrame`. Comunicación con IndexedDB via `postMessage`. |

## 3. STACK TECNOLÓGICO OBLIGATORIO

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Lenguaje | TypeScript (estricto) | Tipado seguro |
| Build | Vite 5 + React 18 | Rapidez, HMR, PWA |
| Routing | React Router v6 | Navegación lazy de módulos |
| Estado Global | Zustand | Ligero, persistencia selectiva |
| DB Local | Dexie.js (wrapper IndexedDB) | Versioning, queries reactivas |
| Estilos | Tailwind CSS 3 | Utility-first, purge automático |
| PWA | vite-plugin-pwa | Service Worker, caching offline |
| Testing | Vitest + React Testing Library | Tests de inmutabilidad |
| 3D Avatar | Three.js + @react-three/fiber | Renderizado 3D offline |
| IA Local | WebLLM + Orama + Whisper WASM + Piper TTS + Rhubarb WASM | Edge computing completo |

## 4. CONVENCIONES DE CÓDIGO

- **Archivos**: PascalCase para componentes, camelCase para hooks/utils
- **Un componente por archivo**: Cada archivo exporta un único componente principal
- **Estructura de carpetas**: `src/modules/[bloque]/[modulo]/Componente.tsx`
- **Interfaces**: Prefijo `I` (ej. `IComponentState`), tipos sin prefijo
- **Archivos de tipos**: `src/types/[dominio].ts`

## 5. VALIDACIÓN PRE-COMMIT Y PROTOCOLO DE ITERACIÓN RÁPIDA

### Protocolo de iteración rápida (NO correr toda la suite en cada iteración)
La suite completa es lenta y hace perder tiempo. En la iteración diaria se corren
**solo los tests de la tarea trabajada**:
- `npm test` → `vitest run --changed` (solo tests de lo cambiado) — iteración rápida.
- `npm run test:file <ruta>` → corre exactamente el test de la tarea en curso.
- `npm run test:full` → `vitest run` (toda la suite) — reservada para el gate de entrega (CI/push), NUNCA por cada commit.
- El guard `frontend/src/test/protocolGuard.test.ts` protege estas reglas estructuralmente.

### Gates: pre-commit ligero + suite completa en CI/push
- **Pre-commit LIGERO** (por iteración): lint-staged + puerta de tipos (`tsc` incremental). No ejecuta la suite completa para no penalizar cada commit.
- **Push = entrega**: el CI (GitHub Actions) ejecuta la suite completa frontend + backend (backend paralelo con `pytest -n auto` y cobertura) en cada push/PR. El pre-push local es solo typecheck.
- Antes de declarar una entrega concluida, el agente DEBE confirmar que el CI está en verde (o, en ausencia de CI, correr la suite completa una única vez en el cierre).

---

## 6. ACELERACIÓN Y PRECISIÓN DEL DESARROLLO

Reglas genéricas (aplicables a cualquier proyecto) para acelerar el ciclo de desarrollo
sin sacrificar precisión. Complementan a la Sección 5. Varias refuerzan reglas ya
existentes de la Sección 1 (se citan entre paréntesis); se consolidan aquí como
playbook operativo único, sin duplicar archivos.

### Aceleración del ciclo

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | ✅ Commit por hito funcional en verde | Commitea cada hito en cuanto quede validado (tests + tipos). Checkpoint seguro y pequeño. No acumular cambios sin commitear. |
| 2 | ⚡ Verificación por iteración mínima | El comando por defecto corre SOLO el test del cambio (`--changed`/`-t`); la suite completa solo en cierre de hitos. Blindar con un test guard. |
| 3 | 🚪 Puerta de tipos por iteración | `tsc -b`/`--noEmit` en cada iteración; build completo solo en cierre. Un error de tipos es un error de entrega. |
| 4 | ✂️ Edición sobre bloques ya mapeados | Aplicar diffs con `start_line` conocido, sin re-leer archivos gigantes. No re-leer lo que ya se mapeó. |
| 5 | ⚙️ Paralelismo de herramientas | Comandos y ediciones independientes en un solo mensaje (mismo turno), sin esperas innecesarias. |
| 6 | ⏳ NO timeout:null | Todo comando con timeout finito: rápidos ≤30s, instalaciones ≤120s. (Refuerza regla 0.0 de la Sección 1.) |
| 7 | 📦 Sin backups por iteración | El control de versiones (git) es el backup. No crear copias/backups manuales por iteración. |

### Calidad que previene ralentizaciones

| # | Regla | Descripción |
|---|-------|-------------|
| 8 | 🧹 Depuración diaria de código y archivos muertos/duplicados | (Refuerza regla 14 de la Sección 1.) |
| 9 | 🧪 Sin tests arbitrarios o duplicados | Cada test cubre una regla real y única. (Refuerza regla 11 de la Sección 1.) |
| 10 | 🛤️ Sin rutas dobles | Cada intención converge en una única fuente de verdad. (Refuerza regla 12 de la Sección 1.) |
| 11 | 🩹 Sin parches | Todo error se corrige de fondo. (Refuerza reglas 2 y 13 de la Sección 1.) |
| 12 | 🧅 Separación lógica pura vs. orquestación | Lógica testeable en módulos puros (habilita tests `node` rápidos). |
| 13 | 🎬 E2E solo con cambio de UI | Y solo el spec afectado, no toda la suite E2E. |

### Rendimiento de suite (proyectos grandes)

| # | Regla | Descripción |
|---|-------|-------------|
| 14 | 🧪 Tests de lógica pura en `node` | Los tests de lógica pura (stores, libs, utils, servicios sin DOM) corren en un proyecto Vitest `environment: 'node'`, separado del `jsdom` (lento por DOM/axe/Monaco). Solo los tests de componentes usan `jsdom`. (Refuerza constraint #12.) |
| 15 | 📊 Medir antes de asumir | Antes de optimizar la suite, medir (setup/collect/environment) para atacar el cuello de botella real, no el supuesto. |
| 16 | 🗄️ Cache de transform compartido | Configurar el cache de transform para que los workers NO re-transformen módulos pesados por separado. |
| 17 | 🚫 Cero warnings `act()` | Prohibido notificar verde con warnings `not wrapped in act(...)` o tests dependientes de timing. Tests deterministas: envolver en `act()`, fake timers, sin depender de la carga de la máquina. (Refuerza constraint #12.) |
| 18 | ⚡ Backend paralelo (`pytest -n auto`) | Añadir `pytest-xdist` a los requisitos de desarrollo y `-n auto` en `addopts`: medido 85s→30s (sin cobertura) y ~105s→64s (con cobertura). Cada worker con su DB temporal; recursos compartidos (Redis) tolerantes a concurrencia. |
| 19 | 🦥 Carga perezosa de dependencias pesadas de test | No importar en el `setup` módulos pesados que solo usan pocos tests (p. ej. `axe-core`): importarlos dentro de la función que los usa. Medido: environment de Vitest 4,3s→1,8s por corrida. |
| 20 | ⚡ Typecheck incremental | `"incremental": true` + `tsBuildInfoFile` bajo la caché (ignorada por git). Medido: 6s→2,1s en caliente en cada iteración/gate. |

### Ahorro de tokens / costo de IA

Las optimizaciones de aceleración NO cambian el precio por token; reducen la
cantidad de tokens procesados. Estas reglas minimizan el contexto que el agente
lee y re-procesa en cada iteración.

| # | Regla | Descripción |
|---|-------|-------------|
| 19 | 📖 Leer solo fragmentos necesarios | NO leer archivos completos cuando solo se necesita una sección. Usar lectura por bloques (indentation/slice con `anchor_line`) sobre archivos grandes (stores, clientes API, specs). Cada línea leída es un token procesado. |
| 20 | 🎯 Modelo adecuado por tarea | Usar el modelo más barato que resuelva la tarea: modelos ligeros para refactors triviales, renames, docs y búsquedas; reservar modelos potentes para diseño complejo, debugging profundo y lógica de negocio crítica. |
| 21 | 🔁 Evitar ciclos largos de prueba-error | Antes de ejecutar, razonar el cambio y su verificación esperada. NO lanzar comandos a ciegas esperando ver el error. Un ciclo de prueba-error fallido = contexto de error repetido = tokens desperdiciados. |
| 22 | 🧹 Limpiar archivos temporales del contexto | Eliminar archivos temporales, logs de depuración y artefactos de ejecución (`_time_*.py`, `probe_*.py`, outputs redirigidos a `.txt`) que ensucian el listado de archivos y el contexto. (Refuerza regla 14 de la Sección 1.) |
| 23 | 🧪 Output de tests limpio | Mantener el output de tests sin warnings ni ruido (p.ej. cero warnings `act()`): el modelo lee ese output en cada ejecución. Output limpio = menos tokens por run. (Refuerza constraint #17.) |
| 24 | 🧠 Contexto mínimo por tarea | No arrastrar contexto de tareas previas terminadas. Cada tarea nueva parte de lo mínimo necesario: leer solo lo que la tarea requiere, no re-leer lo ya mapeado. (Refuerza constraint #4.) |

### Windows (solo si aplica)

| # | Regla | Descripción |
|---|-------|-------------|
| 18 | 🪟 Mitigar límite de longitud de línea | En Windows, `lint-staged`/`prettier` falla con "The command line is too long" con muchos archivos a la vez. NO usar `--no-verify` como práctica habitual: partir el commit en lotes menores o configurar `lint-staged` por lotes. `--no-verify` solo en consolidaciones puntuales ya validadas. |

---

**Última actualización**: 2026-09-06
**Versión del documento**: 3.5
**Estado**: Reglas generales de ingeniería aplicables a cualquier proyecto
