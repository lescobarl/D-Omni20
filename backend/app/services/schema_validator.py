"""Servicio de validación de JSON Schemas (Draft 2020-12) — Fase 6 del backlog.

Fase 6 del roadmap Post-MVP: endpoint de validación de JSON Schemas y datos.
La validación usa ``jsonschema`` (Draft 2020-12), la misma referencia que la
generación IA (``schema_service._normalize_schema``). El servicio es stateless,
por lo que se construye por request sin dependencias externas (regla CLAUDE: DI).
"""

from __future__ import annotations

from typing import Any

from jsonschema import Draft202012Validator, SchemaError

from app.services.interfaces import (
    ISchemaValidator,
    SchemaValidationIssue,
    SchemaValidationResult,
)


class SchemaValidatorService(ISchemaValidator):
    """Valida JSON Schemas (Draft 2020-12) y, opcionalmente, datos contra ellos."""

    def validate(
        self,
        *,
        schema: dict[str, Any],
        data: dict[str, Any] | None = None,
    ) -> SchemaValidationResult:
        """Devuelve un resultado agregado (nunca lanza: la API lo serializa).

        - Primero comprueba que ``schema`` sea un JSON Schema Draft 2020-12 válido.
        - Si se aporta ``data``, valida los datos contra el esquema y recoge cada
          incumplimiento como :class:`SchemaValidationIssue`.
        """
        issues: list[SchemaValidationIssue] = []

        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            issues.append(
                SchemaValidationIssue(
                    path="$",
                    message=str(exc.message),
                    keyword=None,
                )
            )
            return SchemaValidationResult(valid=False, issues=issues, errors=1)

        if data is None:
            return SchemaValidationResult(valid=True, issues=issues, errors=0)

        validator = Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(data), key=lambda err: list(err.absolute_path))
        for error in errors:
            path = ".".join(str(part) for part in error.absolute_path) or "$"
            issues.append(
                SchemaValidationIssue(
                    path=path,
                    message=str(error.message),
                    keyword=str(error.validator) if error.validator else None,
                )
            )
        return SchemaValidationResult(
            valid=len(errors) == 0,
            issues=issues,
            errors=len(errors),
        )
