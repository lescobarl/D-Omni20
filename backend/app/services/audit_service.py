"""Servicio de auditoría estructurada (regla CLAUDE: log de auditoría).

Contrato:
- ``record`` inserta en ``audit_logs`` usando el contexto de correlación del
  request (contextvars); los fallos de escritura NUNCA se silencian y se
  elevan como :class:`AuditLogError` con contexto.
- ``list`` pagina las entradas de auditoría de un tenant.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.core.errors import AuditLogError
from app.core.logging import ILogger
from app.core.tenancy import RequestContext, parse_tenant_id
from app.repositories.interfaces import IAuditRepository
from app.schemas.audit import AuditLogRead
from app.schemas.common import Page
from app.services.interfaces import IAuditService


class AuditService(IAuditService):
    def __init__(self, *, repository: IAuditRepository, logger: ILogger) -> None:
        self._repository = repository
        self._logger = logger

    def record(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        ctx = RequestContext.as_dict()
        try:
            # El tenant se pasa explícito desde el servicio (el contextvar no
            # atraviesa los hilos de los sync deps/endpoints); se mantiene el
            # contexto como fallback para otros llamadores.
            resolved_tenant = (
                tenant_id if tenant_id is not None else parse_tenant_id(ctx.get("tenant_id"))
            )
            self._repository.record(
                tenant_id=resolved_tenant,
                user_id=ctx.get("user_id"),
                request_id=ctx.get("request_id") or "unknown",
                operation=operation,
                entity_type=entity_type,
                entity_id=entity_id,
                details=details,
            )
        except AuditLogError:
            raise
        except Exception as exc:  # noqa: BLE001 - se envuelve con contexto, nunca se silencia
            raise AuditLogError(
                "No se pudo registrar la operación en el log de auditoría",
                operation=f"audit.record:{operation}",
                context={
                    "operation": operation,
                    "entity_type": entity_type,
                    "entity_id": str(entity_id) if entity_id else None,
                },
            ) from exc

    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> Page[AuditLogRead]:
        items, total = self._repository.list(
            tenant_id=tenant_id,
            page=page,
            page_size=page_size,
            operation=operation,
        )
        return Page(
            items=[AuditLogRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )
