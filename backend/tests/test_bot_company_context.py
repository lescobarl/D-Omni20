"""Pruebas del contexto de empresa del bot por request (contextvars, Fase 3).

Regla CLAUDE tenancy: el contexto se fija por request/webhook y se limpia
SIEMPRE al salir (:func:`company_scope` con ``finally``), evitando fugas de
tenant entre requests.
"""

from __future__ import annotations

import uuid

import pytest

from app.bot.company_context import CompanyContext, CompanyRequestContext, company_scope


def _context() -> CompanyContext:
    return CompanyContext(
        tenant_id=uuid.uuid4(),
        channel_id=uuid.uuid4(),
        channel_type="whatsapp",
        external_contact_id="+5215500000000",
        request_id="req-1",
        extra={"source": "test"},
    )


def test_empty_outside_scope() -> None:
    CompanyRequestContext.reset()
    assert CompanyRequestContext.get() is None
    assert CompanyRequestContext.get_tenant_id() is None


def test_company_scope_sets_and_clears() -> None:
    CompanyRequestContext.reset()
    context = _context()

    with company_scope(context):
        assert CompanyRequestContext.get() == context
        assert CompanyRequestContext.get_tenant_id() == context.tenant_id

    # Al salir se limpia SIEMPRE (incluso en el flujo feliz).
    assert CompanyRequestContext.get() is None
    assert CompanyRequestContext.get_tenant_id() is None


def test_company_scope_clears_on_exception() -> None:
    CompanyRequestContext.reset()

    with pytest.raises(RuntimeError):
        with company_scope(_context()):
            raise RuntimeError("boom")

    assert CompanyRequestContext.get() is None
    assert CompanyRequestContext.get_tenant_id() is None


def test_manual_set_get_reset() -> None:
    CompanyRequestContext.reset()
    context = _context()

    CompanyRequestContext.set(context)
    assert CompanyRequestContext.get() == context
    assert CompanyRequestContext.get_tenant_id() == context.tenant_id

    CompanyRequestContext.reset()
    assert CompanyRequestContext.get() is None


def test_scope_is_isolated_between_requests() -> None:
    """Dos scopes anidados no filtran contexto entre sí."""
    CompanyRequestContext.reset()
    first = _context()
    second = _context()

    with company_scope(first):
        with company_scope(second):
            assert CompanyRequestContext.get() == second
        assert CompanyRequestContext.get() == first

    assert CompanyRequestContext.get() is None
