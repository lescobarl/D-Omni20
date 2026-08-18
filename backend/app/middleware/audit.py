"""Middleware de auditoría a nivel request (regla CLAUDE: log de auditoría).

Registra una entrada en ``audit_logs`` por cada request procesado (operación
``http.<method>``), con correlación del contexto activo (request_id, tenant,
user). Usa una sesión propia e independiente de la del endpoint (ya cerrada al
llegar aquí). Los fallos de escritura NUNCA se silencian: se registran como
error estructurado en el log de aplicación con contexto.
"""

from __future__ import annotations

import uuid
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.tenancy import RequestContext, parse_tenant_id

_EXCLUDED_PATHS = {"/health"}


def _audit_details(request: Request, response: Response) -> dict[str, Any]:
    return {
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "query": str(request.url.query) if request.url.query else None,
    }


class AuditRequestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if request.method == "OPTIONS" or request.url.path in _EXCLUDED_PATHS:
            return response

        container = getattr(request.app.state, "container", None)
        if container is None:
            return response

        ctx = RequestContext.as_dict()
        # El contextvar del tenant resuelto no atraviesa ni los saltos de tarea de
        # BaseHTTPMiddleware ni los hilos de los sync deps/endpoints; se usa
        # request.state (State compartido por scope) como canal estable.
        tenant_raw = getattr(request.state, "tenant_id", None) or ctx.get("tenant_id")
        tenant_id = (
            tenant_raw if isinstance(tenant_raw, uuid.UUID) else parse_tenant_id(tenant_raw)
        )
        request_id = (
            getattr(request.state, "request_id", None)
            or ctx.get("request_id")
            or "unknown"
        )
        user_id = getattr(request.state, "user_id", None) or ctx.get("user_id")
        try:
            with container.database.session_scope() as session:
                from app.repositories.sqlalchemy_repositories import (
                    SqlAlchemyAuditRepository,
                )

                repository = SqlAlchemyAuditRepository(session)
                repository.record(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    request_id=request_id,
                    operation=f"http.{request.method.lower()}",
                    entity_type="http_request",
                    details=_audit_details(request, response),
                )
        except Exception:  # noqa: BLE001 - nunca romper la respuesta; se loguea con contexto
            container.logger.error(
                "audit.request_failed",
                message="No se pudo registrar la auditoría del request",
                method=request.method,
                path=request.url.path,
                request_id=ctx.get("request_id"),
            )
        return response
