# Validación de la Fase M — Migración de datos de OmniBot_IA

**Proyecto:** OmniBotIA Studio
**Fecha:** 2026-08-27
**Autor:** Flujo Code (gobernanza CLAUDE.md)
**Estado:** COMPLETADO ✅

## 1. Entregable (plan línea 484)

> Script/seed exporta KB, catálogo, config de empresas y conversaciones; importa a
> `content_items`, `catalog_items`, `tenant_channels`, `bot_company_providers`;
> validar paridad de datos.

**Entregado como:** CLI idempotente y versionado `python -m app.bot.migration` que
lee un export JSON de OmniBot_IA (`schema_version 1.0`) y lo importa de forma
idempotente a las tablas de OmniBotIA Studio, con validación de paridad post-importación.

## 2. Entregables creados

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/bot/migration/schema.py` | Esquema versionado `OmniBotExport` (KB, catálogo, canales, proveedores, conversaciones y mensajes) con `ConfigDict(extra="forbid")`. |
| `backend/app/bot/migration/service.py` | Caso de uso `OmniBotMigrationService` (DI por puertos) + `build_migration_service()` (composition root) + `MigrationReport`/`ParityReport`. |
| `backend/app/bot/migration/cli.py` | CLI con contrato de códigos de salida `0/1/2` y manejo de errores de uso. |
| `backend/app/bot/migration/__main__.py` | Entry point `python -m app.bot.migration` → `raise SystemExit(main())`. |
| `backend/tests/test_bot_migration.py` | 13 pruebas: 9 del servicio + 4 del CLI. |

## 3. Comportamiento validado

- **Importación idempotente** a `content_items`, `catalog_items`, `tenant_channels`,
  `bot_company_providers`, `bot_conversations` y `bot_messages` (los mensajes son
  append-only: re-ejecutar nunca duplica ni sobreescribe).
- **Overwrite controlado**: `--overwrite` actualiza los registros existentes por
  clave natural (el teléfono del canal no se muta en la prueba porque forma parte
  del `message_id` derivado y del enlace conversación↔canal).
- **Cifrado en reposo**: los secretos de canales (`access_token`, `webhook_secret`)
  se guardan cifrados vía `TokenCipher` y se descifran en lectura.
- **Aislamiento multi-tenant**: los `message_id` derivados incluyen `tenant_id`,
  por lo que la restricción global `uq_bot_messages_message_id` no colisiona entre
  empresas aunque importen el mismo export.
- **Paridad de datos**: `validate()` compara el export contra lo persistido y
  reporta desviaciones por sección; `ParityReport.to_dict()` es JSON-friendly.
- **Versionado**: un export con `schema_version` distinto de `1.0` se rechaza con
  error y paridad en `schema`.

## 4. Contrato de códigos de salida del CLI

| Código | Escenario | Prueba |
| --- | --- | --- |
| `0` | Importación exitosa con paridad correcta | `test_cli_import_exit_0_and_persists` ✅ |
| `0` | `--check-only` sobre un export ya importado | `test_cli_check_only_exit_0_after_import` ✅ |
| `1` | `--check-only` con desviaciones de paridad | `test_cli_check_only_exit_1_with_deviations` ✅ |
| `2` | Error de uso/lectura (export inexistente, tenant inexistente, JSON inválido) | `test_cli_usage_error_exit_2` ✅ |

Refactor que lo habilita: `_CliUsageError` en lugar de `SystemExit` en
`_resolve_tenant_id`/`_load_export`, capturado en `main()` → imprime a `stderr` y
devuelve `2`.

## 5. Resultados de pruebas

### Subset (migración + repositorios de configuración)

```
python -m pytest tests/test_bot_migration.py tests/test_tenant_config_repositories.py -q --no-cov
30 passed ✅
```

### Suite completa (con cobertura)

```
python -m pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=80
456 passed ✅  |  Total coverage: 95.06%  |  Gate 80% superado ✅
```

### Cobertura relevante de Fase M

| Módulo | Cobertura |
| --- | --- |
| `app/bot/migration/service.py` | 96% |
| `app/bot/migration/cli.py` | 81% (antes 0%) |
| `app/repositories/sqlalchemy_repositories.py` | 98% |
| `app/bot/migration/__main__.py` | guard de `__main__` (3 líneas, solo ejecutable vía `python -m`) |

## 6. Comandos de operación

```sh
# Importación (paridad validada al final)
python -m app.bot.migration --export-file export.json --tenant-slug acme

# Re-importación actualizando existentes
python -m app.bot.migration --export-file export.json --tenant-id <uuid> --overwrite

# Solo validación de paridad (sin modificar la base)
python -m app.bot.migration --export-file export.json --tenant-slug acme --check-only
```

## 7. Cumplimiento CLAUDE

- **Regla DI / no `new`**: el servicio recibe puertos (repositorios) y el CLI
  compone el grafo vía `build_container(settings)` + `build_migration_service()`.
- **Multi-tenancy**: todo acceso SIEMPRE acotado a `tenant_id`; ids derivados
  incluyen el tenant (defensa en profundidad).
- **Sin hardcode**: el CLI recibe `--db-url`/`--tenant-*`/`--export-file` por
  argumentos; los secretos viajan cifrados en reposo.
- **Auditoría**: el CLI usa el `ILogger` del contenedor; `dispose()` cierra todos
  los recursos creados.
