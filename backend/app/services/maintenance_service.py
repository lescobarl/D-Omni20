"""Backup y restauración de la configuración de operación del bot (B.9).

Cubre la brecha 7 del plan de gaps: el módulo ``database_maintenance_module``
del legado Omnibotia (backup + restaurar configuraciones). En Omni2.0 solo
existían la purga por retención y la optimización física; este servicio añade:

- ``create_backup(tenant_id) -> bytes``: vuelca las 7 tablas de operación del
  bot (``bot_contacts``, ``bot_templates``, ``bot_navigation_trees``,
  ``bot_campaigns``, ``bot_campaign_recipients``, ``bot_interventions`` y
  ``bot_maintenance_config``) acotadas al tenant activo en un documento JSON
  versionado (formato ``omni2.operations.backup`` v1).
- ``restore_backup(tenant_id, data)``: valida el formato y el tenant del
  documento, y restaura las filas en una única transacción (regla CLAUDE:
  transaccionalidad). Registra un evento de auditoría por operación.

Diseño (regla CLAUDE: DI): el servicio depende de ``Database`` (abre sus propias
sesiones vía ``session_scope``) y de una fábrica de auditoría por sesión; nunca
instancia implementaciones con ``new``.
"""

from __future__ import annotations

import json
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Uuid, delete, select

from app.core.database import Database
from app.core.errors import InputValidationError
from app.core.logging import ILogger
from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotContact,
    BotIntervention,
    BotMaintenanceConfig,
    BotNavigationTree,
    BotTemplate,
)
from app.services.interfaces import IAuditService

# Formato del documento de backup (versionado para permitir migraciones futuras).
BACKUP_FORMAT = "omni2.operations.backup"
BACKUP_VERSION = 1

# Operaciones de auditoría.
OPERATION_BACKUP_CREATE = "operations.maintenance.backup.create"
OPERATION_BACKUP_RESTORE = "operations.maintenance.backup.restore"

# Tablas de operación del bot incluidas en el backup, en orden de dependencia
# (padres antes que hijos para que el restore respete las FKs).
_BACKUP_TABLES: tuple[type[Any], ...] = (
    BotContact,
    BotTemplate,
    BotNavigationTree,
    BotCampaign,
    BotCampaignRecipient,
    BotIntervention,
    BotMaintenanceConfig,
)


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Serializa una fila ORM a un dict JSON-serializable (sin claves privadas)."""
    data: dict[str, Any] = {}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        if isinstance(value, (datetime,)):
            value = value.isoformat()
        elif isinstance(value, uuid.UUID):
            value = str(value)
        data[column.name] = value
    return data


def _row_from_dict(model: type[Any], raw: dict[str, Any]) -> dict[str, Any]:
    """Deserializa un dict JSON a los tipos Python que espera el ORM.

    ``_row_to_dict`` serializa ``uuid.UUID`` → ``str`` y ``datetime`` → ISO
    string para que el documento sea JSON puro; al restaurar hay que volver a
    esos tipos nativos, porque las columnas ``Uuid(as_uuid=True)`` y
    ``DateTime(timezone=True)`` no aceptan cadenas (el procesador de ``Uuid``
    llama a ``.hex`` sobre el valor).
    """
    data: dict[str, Any] = {}
    for column in model.__table__.columns:
        if column.name not in raw:
            continue
        value = raw[column.name]
        if value is None:
            data[column.name] = None
            continue
        if isinstance(column.type, Uuid):
            data[column.name] = value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
        elif isinstance(column.type, DateTime):
            data[column.name] = (
                value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
            )
        else:
            data[column.name] = value
    return data


class IMaintenanceService(ABC):
    """Puerto del servicio de backup/restauración de operación del bot (B.9)."""

    @abstractmethod
    def create_backup(self, *, tenant_id: uuid.UUID) -> bytes:
        """Genera un backup del tenant como documento JSON versionado (bytes)."""

    @abstractmethod
    def restore_backup(self, *, tenant_id: uuid.UUID, data: bytes) -> dict[str, Any]:
        """Valida y restaura un backup del tenant en una transacción.

        Devuelve un resumen con el número de filas restauradas por tabla.
        """


class MaintenanceService(IMaintenanceService):
    """Implementación de backup/restauración sobre las tablas de operación."""

    def __init__(
        self,
        *,
        database: Database,
        logger: ILogger,
        audit_factory: Any,
    ) -> None:
        self._database = database
        self._logger = logger
        self._audit_factory = audit_factory

    def create_backup(self, *, tenant_id: uuid.UUID) -> bytes:
        """Vuelca las 7 tablas de operación del tenant en un JSON versionado."""
        tables: dict[str, list[dict[str, Any]]] = {}
        with self._database.session_scope() as session:
            for model in _BACKUP_TABLES:
                rows = session.scalars(
                    select(model).where(model.tenant_id == tenant_id)
                ).all()
                tables[model.__tablename__] = [_row_to_dict(row) for row in rows]

            # Auditoría dentro de la misma transacción (sesión viva).
            audit: IAuditService = self._audit_factory(session)
            audit.record(
                tenant_id=tenant_id,
                operation=OPERATION_BACKUP_CREATE,
                entity_type="maintenance",
                details={"tables": {name: len(rows) for name, rows in tables.items()}},
            )

        document: dict[str, Any] = {
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "tenant_id": str(tenant_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "tables": tables,
        }
        return json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")

    def restore_backup(self, *, tenant_id: uuid.UUID, data: bytes) -> dict[str, Any]:
        """Valida el documento y restaura las filas en una única transacción."""
        try:
            document = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise InputValidationError(
                "El archivo de backup no es un documento JSON válido",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            ) from exc

        if not isinstance(document, dict):
            raise InputValidationError(
                "El backup debe ser un objeto JSON",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            )
        if document.get("format") != BACKUP_FORMAT:
            raise InputValidationError(
                "Formato de backup no reconocido",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            )
        if document.get("version") != BACKUP_VERSION:
            raise InputValidationError(
                f"Versión de backup no soportada: {document.get('version')}",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            )
        if document.get("tenant_id") != str(tenant_id):
            raise InputValidationError(
                "El backup pertenece a otro tenant",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            )

        tables = document.get("tables")
        if not isinstance(tables, dict):
            raise InputValidationError(
                "El backup no contiene la sección de tablas",
                operation=OPERATION_BACKUP_RESTORE,
                context={"tenant_id": str(tenant_id)},
            )

        restored: dict[str, int] = {}
        with self._database.session_scope() as session:
            # Restauración transaccional: primero se limpia el estado actual del
            # tenant y luego se insertan las filas del documento. Cualquier error
            # revierte todo (session_scope hace rollback automático).
            for model in _BACKUP_TABLES:
                session.execute(
                    delete(model).where(model.tenant_id == tenant_id)
                )
            for model in _BACKUP_TABLES:
                table_name = model.__tablename__
                rows = tables.get(table_name, [])
                if not isinstance(rows, list):
                    raise InputValidationError(
                        f"Sección de tabla inválida: {table_name}",
                        operation=OPERATION_BACKUP_RESTORE,
                        context={"tenant_id": str(tenant_id)},
                    )
                for raw in rows:
                    if not isinstance(raw, dict):
                        raise InputValidationError(
                            f"Fila inválida en {table_name}",
                            operation=OPERATION_BACKUP_RESTORE,
                            context={"tenant_id": str(tenant_id)},
                        )
                    # Fuerza el tenant del documento en cada fila (defensa en
                    # profundidad frente a backups manipulados) y deserializa los
                    # tipos (uuid/datetime) que el JSON serializó como cadenas.
                    raw = dict(raw)
                    raw["tenant_id"] = tenant_id
                    session.add(model(**_row_from_dict(model, raw)))
                restored[table_name] = len(rows)

            # Auditoría dentro de la misma transacción (sesión viva): si el
            # registro de auditoría falla, el restore completo se revierte.
            audit: IAuditService = self._audit_factory(session)
            audit.record(
                tenant_id=tenant_id,
                operation=OPERATION_BACKUP_RESTORE,
                entity_type="maintenance",
                details={"restored": restored},
            )

        self._logger.info(
            "Backup restaurado",
            extra={"tenant_id": str(tenant_id), "restored": restored},
        )
        return restored
