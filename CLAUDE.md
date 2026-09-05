# Reglas de Ingeniería — OmniBotIA Studio (repo)

> Documento de reglas **versionado dentro del repo** (`omnibotia-studio/CLAUDE.md`).
> Complementa la `CLAUDE.md` general del workspace (raíz del proyecto) con las
> reglas operativas específicas de este repositorio. Este archivo viaja con el
> código y es validado estructuralmente por el guard test
> `frontend/src/test/protocolGuard.test.ts`.

---

## Protocolo de Iteración Rápida (tests)

**Objetivo**: NO ejecutar toda la suite de pruebas en cada iteración. La suite
completa (~1169 tests) es lenta y hace perder tiempo. En la iteración diaria se
corren **solo los tests de la tarea trabajada**; la suite completa se reserva
para cierres de hito y el gate pre-commit.

### Comandos

| Comando | Qué ejecuta | Cuándo usarlo |
|---------|-------------|---------------|
| `npm test` | `vitest run --changed` — **solo los tests de los archivos cambiados** desde el último commit | Iteración rápida diaria |
| `npm run test:file <ruta>` | `vitest run <ruta>` — **exactamente el test de la tarea** en curso | Cuando trabajas un archivo concreto |
| `npm run test:full` | `vitest run` — **toda la suite** | Cierre de hito y gate pre-commit |
| `npm run test:watch` | `vitest` — modo watch | Desarrollo continuo |

### Reglas inmutables del protocolo

1. `npm test` DEBE incluir `--changed` (nunca debe volver a correr toda la suite).
2. El script `test:full` NO debe eliminarse: es el único camino explícito a la suite completa.
3. El gate **pre-commit** usa `npm run test:full` (el commit es una entrega y valida la suite completa).
4. El guard test `frontend/src/test/protocolGuard.test.ts` protege estas reglas de forma
   estructural: si se degrada el protocolo, la suite falla.

---

**Última actualización**: 2026-09-05
**Versión del documento**: 1.0
**Estado**: Reglas operativas del repositorio OmniBotIA Studio
