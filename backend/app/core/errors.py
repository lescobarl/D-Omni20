"""Gestión de errores con contexto (reglas CLAUDE #5 y #8).

Contrato:
- Jerarquía de excepciones derivadas de :class:`AppError`.
- Toda excepción incluye: ``operation``, ``context`` (dict descriptivo),
  ``code`` (máquina), ``status_code`` (HTTP) y ``error_id`` (correlación).
- El middleware global captura :class:`AppError`, lo registra en el log de
  auditoría estructurado y responde JSON con contexto — nunca silencia.
"""

from __future__ import annotations

import uuid
from typing import Any


class AppError(Exception):
    """Error base de la aplicación con contexto descriptivo.

    :param message: Mensaje humano del error.
    :param operation: Operación (dominio) que falló, ej. ``landing.create``.
    :param context: Contexto adicional estructurado (tenant_id, entity_id...).
    :param cause: Excepción original (no se pierde el encadenamiento).
    """

    status_code: int = 500
    code: str = "app.error"
    default_message: str = "Error de aplicación"

    def __init__(
        self,
        message: str | None = None,
        operation: str | None = None,
        *,
        context: dict[str, Any] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        self.operation = operation or self.code
        self.context: dict[str, Any] = dict(context or {})
        self.error_id: str = uuid.uuid4().hex
        self.cause: BaseException | None = cause
        super().__init__(message or self.default_message)

    def to_dict(self) -> dict[str, Any]:
        """Serializa el error a JSON con contexto para el cliente y monitoreo."""
        return {
            "error": {
                "code": self.code,
                "message": str(self),
                "operation": self.operation,
                "error_id": self.error_id,
                "status_code": self.status_code,
                "context": self.context,
            }
        }


class ConfigValidationError(AppError):
    """Falta o es inválida una variable de configuración requerida."""

    status_code = 500
    code = "config.validation_error"
    default_message = "Configuración inválida o incompleta"


class InputValidationError(AppError):
    """El payload de entrada no cumple el contrato del endpoint."""

    status_code = 422
    code = "validation.input_error"
    default_message = "Datos de entrada inválidos"


class NotFoundError(AppError):
    """Recurso inexistente (o fuera del tenant actual)."""

    status_code = 404
    code = "resource.not_found"
    default_message = "Recurso no encontrado"


class ConflictError(AppError):
    """Conflicto de unicidad / estado (ej. campaign_id duplicado)."""

    status_code = 409
    code = "resource.conflict"
    default_message = "Conflicto con el estado actual del recurso"


class TenantIsolationError(AppError):
    """Violación de aislamiento multi-tenant (contexto de tenant inválido)."""

    status_code = 403
    code = "tenant.isolation_violation"
    default_message = "Contexto de tenant inválido o ausente"


class DependencyError(AppError):
    """Fallo de una dependencia externa (DB, IA, Redis) con contexto."""

    status_code = 503
    code = "dependency.failed"
    default_message = "Dependencia externa no disponible"


class AuditLogError(AppError):
    """Fallo al registrar una entrada de auditoría (nunca silenciado)."""

    status_code = 500
    code = "audit.write_failed"
    default_message = "No se pudo registrar la operación en el log de auditoría"


class UnhandledError(AppError):
    """Error no previsto propagado con contexto y correlación."""

    status_code = 500
    code = "internal.unhandled"
    default_message = "Error interno no controlado"
