"""Interfaz de línea de comandos de la migración de datos (Fase M).

Importa de forma idempotente un export JSON versionado de OmniBot_IA hacia
D-Omni2.0 (``content_items``, ``catalog_items``, ``tenant_channels``,
``bot_company_providers``, ``bot_conversations`` y ``bot_messages``) y valida
la paridad de los datos persistidos.

Uso:

    python -m app.bot.migration --export-file export.json --tenant-slug acme
    python -m app.bot.migration --export-file export.json --tenant-id <uuid> --overwrite
    python -m app.bot.migration --export-file export.json --tenant-slug acme --check-only

Códigos de salida:
- ``0``: operación exitosa y paridad correcta.
- ``1``: la operación terminó con errores o desviaciones de paridad.
- ``2``: error de uso o de lectura/validación del export.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from typing import Any, Sequence

from app.bot.migration.schema import OmniBotExport
from app.bot.migration.service import build_migration_service
from app.config.settings import Settings, get_settings
from app.core.di import build_container
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantRepository


class _CliUsageError(Exception):
    """Error de uso/lectura del CLI (exit code ``2`` según el contrato)."""


def _build_parser() -> argparse.ArgumentParser:
    """Construye el parser de argumentos del CLI (composition root de la CLI)."""
    parser = argparse.ArgumentParser(
        prog="python -m app.bot.migration",
        description=(
            "Migra datos de OmniBot_IA (export JSON versionado) hacia D-Omni2.0 "
            "e importa a content_items, catalog_items, tenant_channels, "
            "bot_company_providers, bot_conversaciones y bot_messages."
        ),
    )
    parser.add_argument(
        "--export-file",
        required=True,
        type=Path,
        help="Ruta al archivo JSON de export (schema_version 1.0).",
    )
    tenant = parser.add_mutually_exclusive_group(required=True)
    tenant.add_argument(
        "--tenant-id",
        type=uuid.UUID,
        default=None,
        help="UUID del tenant destino (debe existir en la base).",
    )
    tenant.add_argument(
        "--tenant-slug",
        default=None,
        help="Slug del tenant destino (debe existir en la base; p. ej. 'acme').",
    )
    parser.add_argument(
        "--db-url",
        default=None,
        help=(
            "URL de la base de datos destino. Opcional: si se omite se usa "
            "DATABASE_URL del entorno/archivos .env."
        ),
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help=(
            "Actualiza los registros existentes que coinciden con la clave "
            "natural de cada sección (los mensajes son siempre append-only)."
        ),
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Solo valida la paridad sin modificar la base (no importa).",
    )
    return parser


def _resolve_tenant_id(container: Any, *, tenant_id: uuid.UUID | None, tenant_slug: str | None) -> uuid.UUID:
    """Resuelve y valida el tenant destino (por id o por slug)."""
    with container.database.session_scope() as session:
        repository = SqlAlchemyTenantRepository(session)
        if tenant_id is not None:
            tenant = repository.get_by_id(tenant_id)
            if tenant is None:
                raise _CliUsageError(f"no existe tenant con id {tenant_id}")
            return tenant.id
        tenant = repository.get_by_slug(str(tenant_slug))
        if tenant is None:
            raise _CliUsageError(f"no existe tenant con slug '{tenant_slug}'")
        return tenant.id


def _load_export(export_file: Path) -> OmniBotExport:
    """Carga y valida el export JSON (fail-fast con mensaje claro)."""
    try:
        payload: Any = json.loads(export_file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise _CliUsageError(f"no existe el archivo de export: {export_file}")
    except OSError as exc:
        raise _CliUsageError(f"no se pudo leer el export: {exc}")
    except json.JSONDecodeError as exc:
        raise _CliUsageError(f"el export no es JSON válido: {exc}")
    try:
        return OmniBotExport.model_validate(payload)
    except Exception as exc:  # pydantic.ValidationError con detalle
        raise _CliUsageError(f"el export no cumple el esquema (schema_version 1.0): {exc}")


def main(argv: Sequence[str] | None = None) -> int:
    """Punto de entrada del CLI; devuelve el código de salida del proceso.

    Códigos de salida (contrato):
    - ``0``: operación exitosa y paridad correcta.
    - ``1``: la operación terminó con errores o desviaciones de paridad.
    - ``2``: error de uso o de lectura/validación del export.
    """
    args = _build_parser().parse_args(argv)
    try:
        export = _load_export(args.export_file)
    except _CliUsageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # ``database_url`` es REQUERIDO en Settings; el flag lo sobreescribe sin
    # perder el resto de la configuración (entorno/.env) del proceso.
    settings = Settings(database_url=args.db_url) if args.db_url else get_settings()
    container = build_container(settings)
    try:
        try:
            tenant_id = _resolve_tenant_id(container, tenant_id=args.tenant_id, tenant_slug=args.tenant_slug)
        except _CliUsageError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        with container.database.session_scope() as session:
            service = build_migration_service(
                session,
                tenant_id=tenant_id,
                cipher=container.token_cipher,
                logger=container.logger,
            )
            if args.check_only:
                parity = service.validate(export)
                result: dict[str, Any] = {
                    "ok": parity.ok,
                    "check_only": True,
                    "tenant_id": str(tenant_id),
                    "parity": parity.to_dict(),
                }
            else:
                report = service.run(export, overwrite=args.overwrite)
                result = {
                    "ok": report.ok,
                    "tenant_id": str(tenant_id),
                    **report.to_dict(),
                }
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
        return 0 if result["ok"] else 1
    finally:
        container.dispose()
