"""Middleware de auditoría a nivel request (regla CLAUDE: log de auditoría).

Registra una entrada en ``audit_logs`` por cada request procesado (operación
``http.<method>``), con correlación del contexto activo (request_id, tenant,
user). Usa una sesión propia e independiente de la del endpoint (ya cerrada al
llegar aquí). Los fallos de escritura NUNCA se silencian: se registran como
error estructurado en el log de aplicación con contexto.
"""

from __future__ import annotations

import uuid
from functools import partial
from typing import Any

from anyio import to_thread
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.tenancy import RequestContext, parse_tenant_id

_EXCLUDED_PATHS = {"/health"}


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
            # La escritura de auditoría es I/O síncrona (SQLite) que compite con
            # el threadpool de endpoints y con el scheduler por la cerradura de
            # escritura. Ejecutarla aquí bloquearía el event loop completo bajo
            # carga (ninguna petición nueva avanzaría). Se desplaza a un hilo de
            # trabajo: con ``BEGIN IMMEDIATE`` + ``busy_timeout`` la espera es
            # acotada y la respuesta nunca queda retenida por la contienda.
            # OJO: ``anyio.to_thread.run_sync`` NO reenvía kwargs a la función
            # objetivo (solo args posicionales + sus propios parámetros); por eso
            # se liga la llamada con ``functools.partial``.
            await to_thread.run_sync(
                partial(
                    _record_audit,
                    container,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    request_id=request_id,
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    query=str(request.url.query) if request.url.query else None,
                )
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


def _record_audit(
    container: Any,
    *,
    tenant_id: uuid.UUID | None,
    user_id: str | None,
    request_id: str,
    method: str,
    path: str,
    status_code: int,
    query: str | None,
) -> None:
    """Escribe la entrada de auditoría en un hilo de trabajo (fuera del event loop)."""
    with container.database.session_scope() as session:
        from app.repositories.sqlalchemy_repositories import (
            SqlAlchemyAuditRepository,
        )

        repository = SqlAlchemyAuditRepository(session)
        repository.record(
            tenant_id=tenant_id,
            user_id=user_id,
            request_id=request_id,
            operation=f"http.{method.lower()}",
            entity_type="http_request",
            details={
                "method": method,
                "path": path,
                "status_code": status_code,
                "query": query,
            },
        )
