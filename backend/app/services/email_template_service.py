"""Servicio de renderizado de plantillas de email con Jinja2 (Fase 4 del backlog).

Centraliza la composición de correos transaccionales a partir de plantillas
HTML seguras (autoescape) almacenadas en ``email_templates/``. El emisor SMTP
y el scheduler inyectan una instancia de :class:`EmailTemplateService` (regla
CLAUDE: DI, sin ``new``) y delegan en ella el renderizado.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import jinja2

from app.core.errors import ConfigValidationError
from app.core.logging import ILogger


class EmailTemplateService:
    """Renderiza plantillas HTML de email con Jinja2 (autoescape activo).

    Se construye con el directorio de plantillas y valida su existencia al
    instanciarse (fail-fast, ``ConfigValidationError``). El renderizado es
    aislado por template y no requiere estado mutable.
    """

    def __init__(self, *, templates_dir: str, logger: ILogger) -> None:
        self._templates_dir = Path(templates_dir)
        self._logger = logger
        if not self._templates_dir.is_dir():
            raise ConfigValidationError(
                "directorio de plantillas de email no existe",
                operation="email_template_service.init",
                context={"templates_dir": str(self._templates_dir)},
            )
        self._environment = jinja2.Environment(
            loader=jinja2.FileSystemLoader(str(self._templates_dir)),
            autoescape=jinja2.select_autoescape(("html", "htm", "xml")),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    @property
    def templates_dir(self) -> Path:
        """Directorio de plantillas (relativo o absoluto, tal como se configuró)."""
        return self._templates_dir

    def render(
        self, template_name: str, *, context: dict[str, Any] | None = None
    ) -> str:
        """Renderiza ``template_name`` con ``context`` y devuelve el HTML.

        Lanza ``jinja2.TemplateNotFound`` si la plantilla no existe. El HTML se
        escapa automáticamente (autoescape) para evitar inyección de contenido.
        """
        template = self._environment.get_template(template_name)
        rendered = template.render(**(context or {}))
        self._logger.debug(
            "workflow.email.template_rendered",
            message="Plantilla de email renderizada",
            template_name=template_name,
            size_bytes=len(rendered.encode("utf-8")),
        )
        return rendered
