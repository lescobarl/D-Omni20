"""Contexto de tenancy y correlación por request (regla CLAUDE RLS multi-tenant).

Contrato:
- ``contextvars`` por request: ``request_id``, ``tenant_id``, ``user_id``.
- El middleware de request asigna estos valores; los logs y auditoría los
  incluyen automáticamente.
- ``set_app_current_tenant`` aplica ``SET LOCAL app.current_tenant_id`` dentro
  de la transacción activa (PostgreSQL) para que RLS la evalúe.
"""

from __future__ import annotations

import contextvars
import uuid
from typing import Any

from sqlalchemy.engine import Connection

# Contexto por request (aislado por contextvars, nunca variables globales).
_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
_tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("tenant_id", default=None)
_user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_id", default=None)


class RequestContext:
    """Puerto de lectura/escritura del contexto de correlación por request."""

    @staticmethod
    def new_request() -> str:
        """Inicia un nuevo contexto de request y devuelve el request_id."""
        request_id = uuid.uuid4().hex
        _request_id_var.set(request_id)
        _tenant_id_var.set(None)
        _user_id_var.set(None)
        return request_id

    @staticmethod
    def set_tenant(tenant_id: str | None) -> None:
        _tenant_id_var.set(tenant_id)

    @staticmethod
    def set_user(user_id: str | None) -> None:
        _user_id_var.set(user_id)

    @staticmethod
    def reset() -> None:
        _request_id_var.set("")
        _tenant_id_var.set(None)
        _user_id_var.set(None)

    @staticmethod
    def request_id() -> str:
        return _request_id_var.get()

    @staticmethod
    def tenant_id() -> str | None:
        return _tenant_id_var.get()

    @staticmethod
    def user_id() -> str | None:
        return _user_id_var.get()

    @staticmethod
    def as_dict() -> dict[str, Any]:
        """Snapshot del contexto para logs estructurados."""
        return {
            "request_id": RequestContext.request_id(),
            "tenant_id": RequestContext.tenant_id(),
            "user_id": RequestContext.user_id(),
        }


def parse_tenant_id(value: str | None) -> uuid.UUID | None:
    """Parsea el tenant del contexto (string UUID) o devuelve None."""
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        return None


def set_app_current_tenant(connection: Connection, tenant_id: str | None) -> None:
    """Aplica el tenant actual como GUC de sesión/transacción (PostgreSQL).

    Solo aplica en backends que soporten ``SET LOCAL`` (PostgreSQL). En SQLite
    (tests/dev) el aislamiento lo garantiza el repositorio a nivel de query.
    """
    if connection.dialect.name == "postgresql":
        value = "NULL" if not tenant_id else f"'{tenant_id}'"
        connection.execute(  # noqa: S608 - valor escapado por SQLAlchemy text param
            _SET_LOCAL_TENANT_SQL,
            {"tenant_id": tenant_id or None},
        )


_SET_LOCAL_TENANT_SQL = """
    SELECT set_config('app.current_tenant_id', :tenant_id, true)
"""
