"""Servicio de matriz programática PSEO (Fase B) con resolución segura.

Contrato:
- Resolución estricta por whitelist de exactamente 4 tokens Jinja
  (``{{ city }}``, ``{{ service_name }}``, ``{{ service_slug }}``,
  ``{{ offer_price }}``). Cualquier otro ``{{``, ``{%`` o ``{#`` restante se
  rechaza con 422 (anti-SSTI).
- Los valores sustituidos se escapan con ``html.escape`` EN EL PUNTO DE
  SUSTITUCIÓN; el config resuelto completo queda pre-escapado, por lo que la
  plantilla ``pseo`` lo renderiza con ``| safe`` sin doble escape (anti-XSS y
  sin entidades dobles en el HTML final).
- Validación estricta de filas: slugify de ``city``/``service_slug`` (rechaza
  ``..``, ``/``, ``\\``, espacios y no-ASCII), precio numérico, sin duplicados
  ``(city, service_slug)`` y ≤ 500 filas.
- El config resuelto se valida contra ``EXTENDED_CONFIG_SCHEMA`` (Draft 2020-12)
  y se compila con ``template_name="pseo"``.
- Auditoría: ``matrix.upload`` (filas) y ``batch.compile`` (páginas) con
  ``IAuditService``.

El servicio depende de interfaces (compilador, validador de schema, auditoría,
logger) inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import copy
import html
import re
import uuid
from typing import Any

from app.core.errors import InputValidationError
from app.core.logging import ILogger
from app.schemas.pseo_config_schema import EXTENDED_CONFIG_SCHEMA
from app.services.interfaces import (
    IAuditService,
    ICompilerService,
    IDataMatrixService,
    ISchemaValidator,
    MatrixRowData,
    ResolvedPage,
)

_MAX_ROWS = 500

#: Slug estricto: segmento alfanumérico + separadores ``-``/``.`` únicos (rechaza
#: espacios, ``..``, ``/``, ``\`` y caracteres no ASCII).
_SLUG_RE = re.compile(r"^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$")

#: Precio numérico: enteros o decimales con hasta 2 cifras.
_PRICE_RE = re.compile(r"^\d+(\.\d{1,2})?$")

#: Whitelist de exactamente 4 tokens sustituibles en el config base.
_TOKEN_PATTERN = re.compile(
    r"\{\{\s*(city|service_name|service_slug|offer_price)\s*\}\}"
)

#: Marcas Jinja que se rechazan si quedan tras la sustitución (anti-SSTI).
_JINJA_LEFT_OVER = ("{{", "{%", "{#")


def _collect_strings(node: Any, found: list[str]) -> None:
    """Acumula todos los strings del config (recursivo) para el escaneo anti-Jinja."""
    if isinstance(node, dict):
        for value in node.values():
            _collect_strings(value, found)
    elif isinstance(node, list):
        for value in node:
            _collect_strings(value, found)
    elif isinstance(node, str):
        found.append(node)


class DataMatrixService(IDataMatrixService):
    def __init__(
        self,
        *,
        compiler: ICompilerService,
        validator: ISchemaValidator,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._compiler = compiler
        self._validator = validator
        self._audit = audit
        self._logger = logger

    # -- validación de filas -------------------------------------------------
    def _validate_rows(self, rows: list[MatrixRowData]) -> None:
        if not rows:
            raise InputValidationError(
                "La matriz no puede estar vacía",
                operation="matrix.validate",
            )
        if len(rows) > _MAX_ROWS:
            raise InputValidationError(
                f"La matriz excede el máximo de {_MAX_ROWS} filas",
                operation="matrix.validate",
                context={"max_rows": _MAX_ROWS, "received": len(rows)},
            )
        seen: set[tuple[str, str]] = set()
        for index, row in enumerate(rows):
            issues: list[str] = []
            if not _SLUG_RE.match(row.city):
                issues.append(
                    f"city inválida (fila {index}): slug estricto sin espacios, "
                    "'..', '/' o caracteres no ASCII"
                )
            if not _SLUG_RE.match(row.service_slug):
                issues.append(
                    f"service_slug inválido (fila {index}): slug estricto sin "
                    "espacios, '..', '/' o caracteres no ASCII"
                )
            if not row.service_name.strip():
                issues.append(f"service_name requerido (fila {index})")
            if not _PRICE_RE.match(row.offer_price):
                issues.append(
                    f"offer_price numérico requerido (fila {index}): enteros o "
                    "decimales con hasta 2 cifras"
                )
            if issues:
                raise InputValidationError(
                    "Matriz inválida",
                    operation="matrix.validate",
                    context={"issues": issues},
                )
            key = (row.city, row.service_slug)
            if key in seen:
                raise InputValidationError(
                    "Duplicado (city, service_slug) en la matriz",
                    operation="matrix.validate",
                    context={"city": row.city, "service_slug": row.service_slug},
                )
            seen.add(key)

    # -- resolución segura ---------------------------------------------------
    def resolve_row(
        self, *, template_config: dict[str, Any], row: MatrixRowData
    ) -> dict[str, Any]:
        config = copy.deepcopy(template_config)
        self._render_strings(config, row)
        # Los datos de la fila se re-inyectan como bloque estructurado para que el
        # config resuelto siempre cumpla ``EXTENDED_CONFIG_SCHEMA`` (Fase A) y
        # transporte los datos a Fase D/E (slug_path, canónicas, JSON-LD).
        config["seo_programmatic"] = {
            "city": html.escape(row.city, quote=True),
            "service_slug": row.service_slug,
            "service_name": html.escape(row.service_name, quote=True),
            "offer_price": row.offer_price,
        }
        self._reject_leftover_jinja(config)
        result = self._validator.validate(schema=EXTENDED_CONFIG_SCHEMA, data=config)
        if not result.valid:
            raise InputValidationError(
                "El config resuelto no cumple el schema extendido",
                operation="matrix.resolve",
                context={"issues": [issue.message for issue in result.issues]},
            )
        return config

    def _render_strings(self, node: Any, row: MatrixRowData) -> None:
        if isinstance(node, dict):
            for key, value in list(node.items()):
                if isinstance(value, str):
                    node[key] = self._render_string(value, row)
                else:
                    self._render_strings(value, row)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                if isinstance(value, str):
                    node[index] = self._render_string(value, row)
                else:
                    self._render_strings(value, row)

    def _render_string(self, value: str, row: MatrixRowData) -> str:
        # Sustitución por whitelist de 4 tokens + escape EN EL PUNTO DE SUSTITUCIÓN.
        rendered = _TOKEN_PATTERN.sub(lambda m: getattr(row, m.group(1)), value)
        return html.escape(rendered, quote=True)

    def _reject_leftover_jinja(self, config: dict[str, Any]) -> None:
        strings: list[str] = []
        _collect_strings(config, strings)
        for value in strings:
            if any(marker in value for marker in _JINJA_LEFT_OVER):
                raise InputValidationError(
                    "Sintaxis Jinja no permitida en el config resuelto "
                    "(solo se admiten los 4 tokens de la whitelist)",
                    operation="matrix.resolve",
                    context={"leftover": value},
                )

    # -- compilación ---------------------------------------------------------
    def compile_page(self, *, config: dict[str, Any]) -> str:
        return self._compiler.compile(config=config, template_name="pseo")

    # -- caso de uso ---------------------------------------------------------
    def process_matrix(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        template_config: dict[str, Any],
        rows: list[MatrixRowData],
        compile_pages: bool = True,
    ) -> list[ResolvedPage]:
        self._validate_rows(rows)
        pages: list[ResolvedPage] = []
        for row in rows:
            config = self.resolve_row(template_config=template_config, row=row)
            page_html = self.compile_page(config=config) if compile_pages else None
            pages.append(
                ResolvedPage(
                    city=row.city,
                    service_slug=row.service_slug,
                    service_name=row.service_name,
                    offer_price=row.offer_price,
                    config=config,
                    html=page_html,
                )
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="matrix.upload",
            entity_type="campaign",
            entity_id=str(campaign_id),
            details={"rows": len(rows)},
        )
        if compile_pages:
            self._audit.record(
                tenant_id=tenant_id,
                operation="batch.compile",
                entity_type="campaign",
                entity_id=str(campaign_id),
                details={"pages": len(pages)},
            )
        self._logger.info(
            "matrix.processed",
            message="Matriz programática resuelta",
            tenant_id=str(tenant_id),
            campaign_id=str(campaign_id),
            rows=str(len(rows)),
            pages=str(len(pages)),
            compile_pages=str(compile_pages),
        )
        return pages
