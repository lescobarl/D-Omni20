"""Middleware de contexto de request (correlación + tenancy best-effort).

Contrato:
- Genera un ``request_id`` por request (``RequestContext.new_request``) y lo
  expone en la respuesta ``X-Request-ID``.
- Captura las cabeceras ``X-Tenant-Id`` / ``X-User-Id`` en el contexto
  (contextvars) para logs y auditoría; la validación/resolución definitiva la
  hace ``get_current_tenant`` en la capa de API.
- Siempre resetea el contexto al final (``finally``) — nunca lo deja "sucio".
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.tenancy import RequestContext

_TENANT_HEADER = "x-tenant-id"
_USER_HEADER = "x-user-id"
_REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = RequestContext.new_request()
        # Captura best-effort del contexto; la validación ocurre en deps.
        tenant_header = request.headers.get(_TENANT_HEADER)
        user_header = request.headers.get(_USER_HEADER)
        # request.state es un State compartido por scope (no contextvars): sobrevive
        # a los saltos de tarea de BaseHTTPMiddleware y a los hilos de los sync
        # deps/endpoints, por lo que la auditoría exterior puede leerlo tras call_next.
        request.state.request_id = request_id
        request.state.tenant_id = tenant_header
        request.state.user_id = user_header
        RequestContext.set_tenant(tenant_header)
        RequestContext.set_user(user_header)
        try:
            response = await call_next(request)
        finally:
            RequestContext.reset()
        response.headers[_REQUEST_ID_HEADER] = request_id
        return response
