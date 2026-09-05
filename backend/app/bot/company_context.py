"""Contexto de empresa del bot por request (contextvars) — regla CLAUDE tenancy.

Complementa :class:`RequestContext` con el contexto de negocio que el bot
necesita durante el procesamiento de un mensaje entrante (tenant, canal y
contacto externo). Se establece por request/webhook y se limpia SIEMPRE al
finalizar (:func:`company_scope`), evitando fugas entre requests.
"""

from __future__ import annotations

import contextlib
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator


@dataclass(frozen=True)
class CompanyContext:
    """Contexto de empresa activo durante el procesamiento de un mensaje."""

    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    channel_type: str = "whatsapp"
    external_contact_id: str = ""
    request_id: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


_current: ContextVar[CompanyContext | None] = ContextVar("bot_company_context", default=None)


class CompanyRequestContext:
    """Puerto de lectura/escritura del contexto de empresa por request."""

    @staticmethod
    def set(context: CompanyContext) -> None:
        _current.set(context)

    @staticmethod
    def get() -> CompanyContext | None:
        return _current.get()

    @staticmethod
    def get_tenant_id() -> uuid.UUID | None:
        context = _current.get()
        return context.tenant_id if context is not None else None

    @staticmethod
    def reset() -> None:
        _current.set(None)


@contextlib.contextmanager
def company_scope(context: CompanyContext) -> Iterator[None]:
    """Fija el contexto de empresa y lo restaura SIEMPRE al salir (``finally``).

    Usa el ``token`` devuelto por :meth:`ContextVar.set` y :meth:`ContextVar.reset`
    para restaurar el valor anterior en lugar de pisarlo con ``None``: así los
    scopes anidados (p. ej. un webhook que procesa varios mensajes) no pierden
    el contexto externo al salir del scope interno.
    """

    token = _current.set(context)
    try:
        yield
    finally:
        _current.reset(token)
