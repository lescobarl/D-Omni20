# Reglas Absolutas de Ingeniería

> Archivo ÚNICO y vinculante de constraints. Se cumple íntegro antes de cualquier
> operación. No existen reglas duplicadas en otros archivos ni comandos.
> Donde una regla no pueda cumplirse, el agente SE DETIENE y pregunta. Nunca la silencia.

---

## 1. VERDAD Y VALIDACIÓN (lo primero, siempre)

Núcleo anti-mentira. Cualquier otra regla se interpreta bajo esta sección.

1. **Nada se notifica como concluido sin validación real productiva.** Validar =
   pruebas funcionales + auditoría visual (captura de pantalla) + técnica, contra el
   sistema vivo. No basta compilar ni pasar tests.
2. **"Listo / hecho / funciona / resuelto / 100% / terminado / concluido / unificado / ya quedó"
   son palabras PROHIBIDAS para el agente.** Reemplazo obligatorio de cierre:
   `Cambios aplicados: [lista] · Validado contra: [qué y cómo] · No validado: [qué falta]`.
   Cuando no se hizo lo ordenado: `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar un avance parcial honesto jamás se penaliza.
3. **"Listo" lo declara el USUARIO al verlo en su pantalla.** Sin su confirmación el
   estado es "en progreso: hice X, falta Y". La confirmación del usuario es condición
   necesaria para declarar entrega; la validación técnica no es suficiente.
4. **Toda afirmación cita su fuente**: comando + salida real copiada, o archivo:línea.
   Sin fuente no se afirma nada.
5. **La verdad es la pantalla del usuario, no los logs.** Si el usuario reporta que no
   coincide, se le cree y se re-investiga. Nunca insistir con el dato propio.
6. **Prohibido afirmar "funciona" validando solo con `TestClient`/mocks.**
   Validar SIEMPRE contra el backend real corriendo en `http://127.0.0.1:8000`
   (nunca `localhost`, que puede resolver a IPv6 `::1`) y contra la DB real del proceso.
7. **Evidencia estructural por hito**: `git diff` real + conteo ANTES/DESPUÉS de la
   invariante. Un hito sin evidencia NO existe: se revierte y se para.
8. **Si un cambio propio rompe**: se anuncia, se revierte mostrando el diff y se corrige
   de raíz. Prohibido esconderlo o declarar éxito falso. Cero disculpas: se corrige.

## 2. PROHIBICIONES ABSOLUTAS

1. **No entregas parciales**: toda tarea se entrega completa y validada según la solicitud.
2. **No hardcode**: toda configuración viene de variables de entorno, archivos de
   configuración o inyección de dependencias. Prohibidos valores quemados.
3. **No parches ni soluciones temporales**: todo error se corrige de fondo, en su causa
   raíz. Cero workarounds para casos de borde.
4. **No `new` en lógica de negocio**: toda dependencia se inyecta mediante interfaces.
5. **No commits directos a `main`/`master`**: flujo con ramas `feature/*`.
6. **No try-catch vacíos ni que silencien errores**: toda excepción se captura, registra
   en el log de auditoría y se propaga con contexto descriptivo.
7. **No modificar +2 archivos de dominio sin interfaz común**: primero se propone el
   diseño de interfaz que los unifica.
8. **No cambios temporales ni rutas dobles**: nada de archivos duplicados para prueba,
   comentarios de código legacy, implementaciones paralelas ni rutas en paralelo para el
   mismo recurso. Una única fuente de verdad por intención.
9. **No borrado físico en offline**: el borrado es lógico (`deleted: true`).
10. **No basura en el proyecto**: depuración diaria de código y archivos muertos,
    duplicados u obsoletos (`_time_*.py`, `probe_*.py`, outputs a `.txt`, backups).
    Git es el backup; no se crean copias manuales por iteración.
11. **No tests arbitrarios ni duplicados**: cada test cubre un caso real y único de la
    especificación. No se duplican coberturas ni se inventan pruebas.
12. **No grandes respuestas**: resumen claro y preciso; detalle solo cuando se pide.
13. **No errores de programación/lógica/implementación**: el código se entrega correcto,
    validado y sin defectos.
14. **No `timeout: null`** en comandos: rápidos ≤30s, instalaciones ≤120s. Servidores
    largos (vite, npm start, etc.): timeout de 15-30s solo para verificar arranque y
    luego verificar con otro comando. `timeout: null` bloquea el chat.
15. **No declarar verde con warnings `act()` ni tests dependientes de timing**:
    tests deterministas con `act()`, fake timers y sin depender de la carga de la máquina.
16. **No ignorar backend "vivo pero inaccesible" en Windows** (bug IocpProactor): puerto
    en LISTENING sin responder HTTP (curl → 000) = proceso zombie. Matar con
    `taskkill /PID <pid> /F` y reiniciar con `python run_dev.py`
    (fuerza `WindowsSelectorEventLoopPolicy`).

## 3. OBLIGACIONES ESTRICTAS

1. **Inyección de dependencias** por interfaces (refuerza prohibición 2.4).
2. **JSDoc en todo componente/método nuevo**: contrato de la interfaz, no implementación.
3. **Responsabilidad Única (SRP)**: cada archivo/clase tiene una única razón de cambio.
4. **Test de inmutabilidad** por pieza: valida que la arquitectura sigue agnóstica al
   negocio tras los cambios.
5. **Log de auditoría** inmutable para todo cambio de configuración.
6. **UUIDv4 en toda inserción**: prohibidas llaves numéricas secuenciales.
7. **Tupla de sincronización** en cada tabla: `[revision, updated_at, deleted]`;
   `revision` se incrementa atómicamente y `updated_at` se actualiza en UTC.
8. **Gestión de errores con contexto** (ver prohibición 2.6).
9. **Aislamiento de contexto de IA**: cada inferencia inicia contexto ciego aislado;
   purgar variables globales residuales antes de cada llamada.
10. **Circular Buffer en audio**: vaciado cíclico cada 30s contra fugas de memoria.
11. **requestAnimationFrame para 3D**: renderizado aislado; comunicación con IndexedDB
    vía `postMessage`.

## 4. STACK TECNOLÓGICO OBLIGATORIO

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Lenguaje | TypeScript (estricto) | Tipado seguro |
| Build | Vite 5 + React 18 | Rapidez, HMR, PWA |
| Routing | React Router v6 | Navegación lazy |
| Estado | Zustand | Ligero, persistencia selectiva |
| DB Local | Dexie.js (IndexedDB) | Versioning, queries reactivas |
| Estilos | Tailwind CSS 3 | Utility-first, purge automático |
| PWA | vite-plugin-pwa | Service Worker, offline |
| Testing | Vitest + React Testing Library | Tests de inmutabilidad |
| 3D Avatar | Three.js + @react-three/fiber | Renderizado 3D offline |
| IA Local | WebLLM + Orama + Whisper WASM + Piper TTS + Rhubarb WASM | Edge computing |

## 5. CONVENCIONES DE CÓDIGO

- Archivos: `PascalCase` componentes, `camelCase` hooks/utils. Un componente por archivo.
- Estructura: `src/modules/[bloque]/[modulo]/Componente.tsx`.
- Interfaces con prefijo `I`; tipos sin prefijo. Tipos en `src/types/[dominio].ts`.

## 6. VALIDACIÓN, ITERACIÓN Y CI

### Iteración rápida (por cambio, no toda la suite)
- `npm test` → `vitest run --changed`; `npm run test:file <ruta>` para la tarea en curso;
  `npm run test:full` SOLO en el gate de entrega (CI/push), nunca por commit.
- Guard estructural: `frontend/src/test/protocolGuard.test.ts`.
- Puerta de tipos `tsc -b`/`--noEmit` en cada iteración; un error de tipos es error de entrega.
- Commit por hito funcional en verde; cambios independientes en paralelo en un mismo turno;
  diffs sobre bloques ya mapeados sin re-leer archivos.

### Gates
- Pre-commit LIGERO: lint-staged + typecheck incremental. Nunca la suite completa.
- Push/PR = entrega: CI ejecuta suite completa frontend + backend (`pytest -n auto` con
  cobertura, workers con DB temporal propia). Antes de declarar entrega, el CI DEBE estar
  en verde (o suite completa corrida una vez en el cierre).

### Rendimiento de suite
- Tests de lógica pura en proyecto Vitest `environment: 'node'`; solo componentes usan
  `jsdom`. Cero warnings `act()`. Medir antes de optimizar. Cache de transform compartido.
  Carga perezosa de dependencias pesadas (`axe-core` dentro de la función que la usa).
  `"incremental": true` + `tsBuildInfoFile` en caché para typecheck caliente.

### Ahorro de tokens (contexto mínimo)
- Leer solo fragmentos necesarios; no re-leer lo ya mapeado. Modelo adecuado por tarea
  (ligero para refactors triviales, docs y búsquedas). Razonar antes de ejecutar; prohibido
  lanzar comandos a ciegas. Mantener output de tests limpio. No arrastrar contexto de
  tareas previas terminadas.

### Windows
- `lint-staged`/`prettier`: "command line is too long" con muchos archivos → partir commits
  en lotes menores. `--no-verify` solo en consolidaciones puntuales ya validadas, nunca
  como práctica habitual.

## 7. ENTREGA Y FOCO (reglas del usuario)

1. **Criterio de aceptación por escrito antes de tocar código** (1-2 líneas de qué verá el
   usuario cuando esté bien). Sin criterio aceptado no se modifica nada. Un "adelante /
   valida / ejecuta" sobre tarea descrita cuenta como aceptación.
2. **Una sola tarea a la vez, sin desvíos.** Hallazgo fuera de alcance → se anota al final
   (`archivo:línea`) y se sigue la tarea. Correcciones extra solo tras aceptar la principal.
3. **Tarea grande/riesgosa** → se parte en pasos escritos y se pide OK por paso. Nunca
   reemplazar en silencio por una parte fácil ni abandonar la tarea ante la dificultad.
4. **"No afectar lo validado" se demuestra con tests** que cubren el cambio; no es excusa
   para evitar el cambio ordenado.
5. **"Ejecuta / hazlo" = primera tool call en esa misma respuesta, sin texto previo.**
   Antes: máximo 1 línea. La explicación va DESPUÉS. Prohibido en la respuesta de
   ejecución: análisis del error, mea culpa, "¿lo hago?". Excepción única: falta
   información real → una pregunta y stop.
6. **No detenerse ante complejidad**: con diagnóstico + localización, se ejecuta completo
   ahora; la validación visual la hace el usuario después. Prohibido "es delicado, ¿sigo?"
   o usar la regla 1.3 para no ejecutar. La regla 1.3 prohíbe DECLARAR listo, no ejecutar.
7. **Cumplir el objetivo completo** (no basta "compila / pasan tests"). Cada cambio se
   anuncia ANTES (archivo + intención) y se muestra DESPUÉS con `git diff` real. Sin
   decisiones ocultas ni reverts silenciosos.

## 8. EVIDENCIA ESTRUCTURAL (anti-cascada de parches)

La unificación NO es fase final: es una invariante que debe decrecer en cada hito.

1. **Criterio de aceptación NUMÉRICO, no visual** (verificable con un comando, p. ej.
   `grep -c 'handleContract' src` = 1). Sin criterio verificable la tarea no se define ni
   se empieza. Lo visual es complementario, nunca sustituto.
2. **Evidencia por hito**: (a) `git diff` real y (b) conteo ANTES/DESPUÉS de la invariante.
   Si el conteo no bajó, el hito es cosmético: se rechaza aunque se vea perfecto.
3. **La invariante se mide en CADA hito**, no al final.
4. **Cada 2-3 hitos el USUARIO re-ejecuta la misma medición** y la compara. Aprobaciones
   previas no son evidencia de la siguiente fase.
5. **Hito sin evidencia → revertir ESE hito y parar** hasta que el conteo baje.
   Alcance corto por hito (ej. "2 archivos + 1 grep"); si se alarga sin reducir la
   invariante, detenerse y re-planificar en voz alta.
6. **Guard automatizado** en toda unificación/refactor de raíz (patrón
   `tests/hardcodeGuard.test.ts`) que falle si hay N>1 implementaciones del símbolo/ruta.
   Un guard que falla solo es la ÚNICA barrera que el agente no puede maquillar.

## 9. PROTOCOLO DE VERDAD Y EJECUCIÓN (contrato, guard y cierre)

> Única fuente canónica del protocolo de ejecución. Operacionaliza §1, §7 y §8;
> donde solape, prevalece la formulación MÁS ESTRICTA. El resto de AGENTS no
> duplica estas reglas: solo referencia.

### 9.0 Principio
Mentir debe ser más caro que decir la verdad. Nada de lo siguiente depende de la
buena voluntad del agente: vive en el repo y en comandos verificables.

### 9.A Conducta
1. **Dos niveles de "hecho" (no confundir):** *DoD-técnico* (comando/gate) lo cierra
   el **agente**; *DoD-producto* (pantalla/uso real) lo cierra el **usuario**. El
   agente **solo adjunta evidencia**; nunca declara el de producto. Sin tu
   confirmación el estado es `en progreso: hice X, falta Y`.
2. **Toda afirmación cita su fuente:** comando + salida real copiada, o
   `archivo:línea`. Sin fuente no se afirma nada.
3. **Si no sabes: UNA pregunta con propuesta por defecto y paro.** Prohibido
   inventar; prohibido encadenar preguntas hasta paralizar.
4. **Parcial honesto:** `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar parcial nunca se penaliza; disfrazarlo, sí.
5. **Si algo tuyo rompe:** revertí **ESE hito**, mostrá el `git diff` real y re-medí.
   Sin reverts silenciosos ni "ya lo arreglé" sin evidencia.
6. **Distinguí HECHO de SUPUESTO.** Etiquetá explícito: `HECHO` (con fuente) vs
   `SUPUESTO` (sin verificar). **Un supuesto no cierra nada.**
7. **Autonomía sin el usuario:** el sustituto de "mi pantalla" es **evidencia
   cruda** (logs reales, `curl`, fila real en DB, salida del gate), definida por
   tarea en §9.B.17. Si no hay sustituto, el hito queda **no validado**.
8. **Cierre en lugar inmutable:** commit/PR body **y** `.task/report`
   **append-only (hash-chain), escrito SOLO por el gate**. No basta el chat.

### 9.B Mecánica anti-maquillaje (lo que vuelve §9.A imposible de fingir)
9. **Contrato ANTES de tocar código**, con 4 campos: **objetivo único, DoD, alcance
   y guard**. La **única fuente** es `.task/contract.json`; un contrato pegado en
   el chat se IGNORA. Sin contrato válido no se empieza.
10. **DoD = comando con valor esperado, no descripción.** Se registra el valor
    **ANTES** y **DESPUÉS**. Si el valor no cambió, la tarea no está hecha.
11. **Guard primero, EN ROJO.** Nace fallando mientras exista la duplicación
    (`N>1`) y enumera los duplicados **programáticamente** como
    `archivo:símbolo:línea`. Si nace verde, la tarea no está definida.
12. **Guard de COMPORTAMIENTO obligatorio.** Todo invariante crítico necesita **≥1
    test que EJECUTE el flujo real** y que **NO mockee la unidad bajo prueba** (un
    conteo `9/9` puede convivir con el sistema roto). Un guard de conteo **no
    cierra solo**.
13. **Tabla de invariantes obligatoria**, aprobada por el usuario antes de empezar:
    **sin aprobación explícita no se implementa en FULL** (en LIGHT puede avanzar
    con aviso). **Ante duda, FULL.**

    | # | Invariante (una frase) | Comando (valor HOY) | META | Guard (hoy ROJO) |
    |---|------------------------|---------------------|------|------------------|
    | 1 | `<...>`                | `rg ... \| wc -l = N` | 0/1 | test que lista duplicados |

14. **Métrica, contrato y guard CONGELADOS.** Los hashes viven **fuera** del
    contrato en `.task/frozen.json` (un documento no puede contener su propio
    hash). Tras `--init`, los archivos de **guard y baseline son READ-ONLY** (hash
    por archivo); solo se permite **AÑADIR** tests. Al cerrar, el gate **recalcula
    los hashes**: mismatch → FAIL. **Enmienda formal:** declarar el cambio,
    re-aprobar el usuario, nuevo hash y reiniciar el hito. Prohibido editar a
    escondidas.
15. **Baseline de fallos** capturado antes de tocar nada; se corre **DOS veces** y
    se acepta una lista explícita de flaky. Cierre = **0 fallos NUEVOS** (no "0
    fallos"). Los preexistentes se documentan como deuda y no se usan como excusa.
16. **Alcance cerrado** (`allow`/`deny`). Inmutables por el agente:
    `.task/contract.json`, `.task/baseline.json`, `.task/frozen.json`,
    `scripts/task-gate.mjs`. `.task/report` lo escribe **solo el gate**.
17. **Ground truth por tarea** (no visual): salida cruda de `curl`, fila real en
    DB o salida del gate, **definido y aprobado** antes de empezar.
18. **Checkpoint/rollback** antes de un hito riesgoso (commit o backup). Si el hito
    rompe: revertir **ese hito** mostrando el diff y re-medir.
19. **Modo LIGHT vs FULL** declarado y congelado. LIGHT solo para docs, typos o
    formato (cierre con `git diff`); todo lo demás es FULL.
20. **La barrera vive en el repo**, no en la buena voluntad: **pre-commit hook +
    job de CI** que ejecutan el gate. Reglas en el chat son promesas; en el repo,
    imposibilidad de mentir.
21. **Timebox anti-hitos cosméticos:** si en **2 hitos consecutivos** la invariante
    no baja, se para y se re-planifica en voz alta (§8.2 y §8.5).

### 9.C Contrato (formato mínimo)

```jsonc
{
  "id": "T-###",
  "mode": "full",                       // "light" | "full"
  "objective": "<una frase>",
  "dod":      { "command": "...", "expect": "valor o regex" },
  "guard":    { "command": "...", "expect": "0", "mustStartRed": true,
                "behavior": "tests/<flujo>.test.ts" },   // EJECUTA el flujo real
  "groundTruth": { "command": "...", "expect": "..." },  // equivalente de "mi pantalla"
  "baseline": { "command": "...", "failPattern": "\\bFAIL\\b" },
  "invariants": [
    { "id": "I1", "statement": "<una frase>", "count": "rg ... | wc -l",
      "today": 3, "target": 1, "guard": "tests/<...>.test.ts" }
  ],
  "allow": ["src/**", "tests/**"],
  "deny":  [".task/contract.json", ".task/baseline.json", ".task/frozen.json",
            "scripts/task-gate.mjs"]
}
```

Flujo: `node scripts/task-gate.mjs --init` (valida contrato, guarda baseline,
escribe `.task/frozen.json` y exige guard ROJO) → implementar **solo en `allow`**
→ `node scripts/task-gate.mjs` (recalcula hashes, corre guard + DoD + ground truth
y exige 0 fallos nuevos).

### 9.D Cuándo parar (y cuándo NO)
Se PARA solo en cuatro casos legítimos:
- **El DoD es imposible** o exigiría sustituir/ampliar el alcance (§9.A.4).
- **El guard no puede nacer rojo**: la tarea no está definida (§9.B.11).
- **Falta información real**: una pregunta con propuesta y paro (§9.A.3).
- **Fin de contrato**, salvo autorización explícita de encadenar ("ejecuta el plan
  completo"); cada contrato conserva su cierre crudo y **no** se funde en un DoD
  compuesto.

NO se para por dificultad, por "es delicado", ni por no poder declarar "hecho"
(§9.A.1 prohíbe DECLARAR, no ejecutar). Prohibido pedir "¿sigo?" con diagnóstico ya
hecho. **Un turno = un contrato**, con la excepción de encadenamiento autorizado.

### 9.E Cierre obligatorio (salida cruda, sin resúmenes)
(a) `git diff --stat` · (b) comando DoD ANTES y DESPUÉS · (c) salida del guard ·
(d) baseline de fallos preexistentes y confirmación de **0 nuevos** ·
(e) `Cambios aplicados · Validado contra · No validado` (cada línea con su fuente).

---

**Última actualización**: 2026-09-11
**Versión del documento**: 6.0
**Cambio clave**: §9 reescrita como «Protocolo de verdad y ejecución» (fuente canónica
única): niveles DoD-técnico/producto, guard de comportamiento sin mocks, hashes
congelados FUERA del contrato (`.task/frozen.json`), guard/baseline read-only,
baseline doble, ground truth por tarea, LIGHT/FULL, timebox anti-cosmético, `.task/report`
append-only escrito por el gate; absorbe y deroga §9/§9.7 anteriores.
