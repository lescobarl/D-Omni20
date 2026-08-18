"""Pruebas de la gestión de errores con contexto (regla CLAUDE #5 y #8)."""

from __future__ import annotations

import pytest

from app.core import errors


def test_app_error_defaults() -> None:
    exc = errors.AppError()
    assert exc.status_code == 500
    assert exc.code == "app.error"
    assert exc.operation == "app.error"
    assert exc.context == {}
    assert exc.error_id


def test_app_error_custom_message() -> None:
    exc = errors.AppError("Algo salió mal")
    assert str(exc) == "Algo salió mal"


@pytest.mark.parametrize(
    ("cls", "status_code", "code", "message"),
    [
        (errors.ConfigValidationError, 500, "config.validation_error", "Configuración inválida o incompleta"),
        (errors.InputValidationError, 422, "validation.input_error", "Datos de entrada inválidos"),
        (errors.NotFoundError, 404, "resource.not_found", "Recurso no encontrado"),
        (errors.ConflictError, 409, "resource.conflict", "Conflicto con el estado actual del recurso"),
        (errors.TenantIsolationError, 403, "tenant.isolation_violation", "Contexto de tenant inválido o ausente"),
        (errors.DependencyError, 503, "dependency.failed", "Dependencia externa no disponible"),
        (errors.AuditLogError, 500, "audit.write_failed", "No se pudo registrar la operación en el log de auditoría"),
        (errors.UnhandledError, 500, "internal.unhandled", "Error interno no controlado"),
    ],
)
def test_error_subclasses(cls: type[errors.AppError], status_code: int, code: str, message: str) -> None:
    exc = cls()
    assert exc.status_code == status_code
    assert exc.code == code
    assert exc.operation == code
    assert message in str(exc)


def test_app_error_with_operation_context_and_cause() -> None:
    cause = ValueError("boom")
    exc = errors.AppError("mensaje", operation="op.test", context={"a": 1}, cause=cause)
    assert exc.operation == "op.test"
    assert exc.context == {"a": 1}
    assert exc.cause is cause

    payload = exc.to_dict()
    assert payload["error"]["code"] == "app.error"
    assert payload["error"]["message"] == "mensaje"
    assert payload["error"]["operation"] == "op.test"
    assert payload["error"]["context"] == {"a": 1}
    assert payload["error"]["status_code"] == 500
    assert payload["error"]["error_id"] == exc.error_id


def test_not_found_error_roundtrip() -> None:
    exc = errors.NotFoundError(
        "Landing no encontrada",
        operation="landing.get",
        context={"landing_id": "abc-123"},
    )
    payload = exc.to_dict()
    assert payload["error"]["code"] == "resource.not_found"
    assert payload["error"]["context"] == {"landing_id": "abc-123"}
