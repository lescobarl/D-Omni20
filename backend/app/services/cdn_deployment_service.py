"""Servicio de despliegue de landings al CDN (Fase 10).

Contrato:
- Toda operación está acotada al ``tenant_id`` activo (defensa en profundidad
  sobre RLS) y se registra en el log de auditoría estructurado.
- El despliegue es append-only: cada llamada crea una ``version`` incremental
  por landing y una ``url`` determinista ``{cdn_base_url}/{landing_id}/v{version}``
  servida por el CDN, con el HTML compilado en el momento del despliegue.
- Errores de dominio se elevan como :class:`AppError` con contexto y
  ``operation`` (regla CLAUDE: error management with context).
- El servicio depende de interfaces (repositorio, auditoría, compilador,
  logger) y de ``Settings`` inyectadas desde el composition root — nunca
  ``new`` (regla DI).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import urlparse

from app.config.settings import Settings
from app.core.errors import NotFoundError
from app.core.logging import ILogger
from app.repositories.interfaces import (
    ICdnDeploymentRepository,
    ILandingRepository,
    ITenantRepository,
)
from app.schemas.cdn import CdnDeployResponse
from app.services.interfaces import (
    IAuditService,
    ICdnDeploymentService,
    ICompilerService,
)


class CdnDeploymentService(ICdnDeploymentService):
    def __init__(
        self,
        *,
        repository: ICdnDeploymentRepository,
        landing_repository: ILandingRepository,
        tenant_repository: ITenantRepository,
        compiler: ICompilerService,
        settings: Settings,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._repository = repository
        self._landing_repository = landing_repository
        self._tenant_repository = tenant_repository
        self._compiler = compiler
        self._settings = settings
        self._audit = audit
        self._logger = logger

    @staticmethod
    def _script_safe_json(payload: dict[str, Any]) -> str:
        """Serializa a JSON seguro dentro de ``<script>`` (Fase C).

        Escapa ``< > & '`` como escapes unicode (mismo efecto que el filtro
        ``tojson`` de Jinja2) para que un valor no pueda cerrar la etiqueta
        ``</script>`` prematuramente. El resultado sigue siendo JSON válido
        (``json.loads`` hace round-trip).
        """
        serialized = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
        return (
            serialized.replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace("'", "\\u0027")
        )

    def _tenant_cdn_base(self, *, tenant_id: uuid.UUID) -> str:
        """Base URL del CDN acotada al subdominio del tenant (C-3 multired).

        Deriva ``{scheme}://{slug}.{client_subdomain_base}/cdn`` del slug del
        tenant cuando el subdominio dinámico está habilitado (regla CLAUDE: nada
        de hardcode, todo dinámico). Si el tenant no existe o el subdominio no
        aplica, cae al ``cdn_base_url`` configurado.
        """
        base = (self._settings.client_subdomain_base or "").strip().lstrip(".")
        if base:
            tenant = self._tenant_repository.get_by_id(tenant_id)
            slug = (getattr(tenant, "slug", "") or "").strip()
            if slug:
                scheme = urlparse(self._settings.cdn_base_url).scheme or (
                    "https" if self._settings.is_production else "http"
                )
                return f"{scheme}://{slug}.{base}/cdn"
        return self._settings.cdn_base_url.rstrip("/")

    def _cdn_origin(self, *, tenant_id: uuid.UUID) -> str:
        """Origen (``scheme://netloc``) del CDN del tenant para servir el embed."""
        parsed = urlparse(self._tenant_cdn_base(tenant_id=tenant_id))
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return ""

    def _inject_embed_config(self, *, html: str, tenant_id: uuid.UUID) -> str:
        """Inyecta ``#omnibotia-config`` antes de ``</head>`` en el HTML del CDN.

        Los bloques ``portal`` y ``lead_form`` del compilador leen
        ``#omnibotia-config`` (``tenantId`` y ``apiBaseUrl``) para cargar
        ``portal.js`` / ``embed.js``. Sin este script esos bloques se desactivan
        (``configEl`` nulo). La inyección replica el patrón de
        :class:`PseoService` (JSON seguro anti-``</script>``) para que el CDN
        sirva landings con el portal del cliente funcional.
        """
        if "</head>" not in html:
            return html

        cdn_origin = self._cdn_origin(tenant_id=tenant_id)
        embed_config = self._script_safe_json(
            {"tenantId": str(tenant_id), "apiBaseUrl": cdn_origin}
        )
        head = (
            f'<script id="omnibotia-config" type="application/json">'
            f"{embed_config}</script>\n"
        )
        if cdn_origin:
            head += f'<script src="{cdn_origin}/static/embed.js" defer></script>\n'
        return html.replace("</head>", f"{head}</head>", 1)

    def deploy(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID
    ) -> CdnDeployResponse:
        landing = self._landing_repository.get(
            tenant_id=tenant_id, landing_id=landing_id
        )
        if landing is None:
            raise NotFoundError(
                "Landing no encontrada",
                operation="cdn.deploy",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )
        started = time.perf_counter()
        latest = self._repository.get_latest(
            tenant_id=tenant_id, landing_id=landing_id
        )
        version = (latest.version + 1) if latest is not None else 1
        base_url = self._tenant_cdn_base(tenant_id=tenant_id)
        url = f"{base_url}/{landing_id}/v{version}"
        html = self._compiler.compile(config=landing.config)
        html = self._inject_embed_config(html=html, tenant_id=tenant_id)
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        deployment = self._repository.create(
            tenant_id=tenant_id,
            landing_id=landing_id,
            version=version,
            url=url,
            status="deployed",
            html=html,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="cdn.deploy",
            entity_type="tenant_landing",
            entity_id=str(landing.id),
            details={"url": url, "version": version, "duration_ms": duration_ms},
        )
        self._logger.info(
            "cdn.deployed",
            message="Landing desplegada al CDN",
            tenant_id=str(tenant_id),
            landing_id=str(landing.id),
            version=str(version),
            url=url,
            duration_ms=str(duration_ms),
        )
        return CdnDeployResponse.model_validate(deployment)

    @staticmethod
    def _rewrite_json_value(html: str, *, marker: str, value: str) -> str:
        """Reescribe el valor JSON (string) que sigue a ``marker`` en el HTML.

        Localiza ``"<marker>":`` y sustituye el valor string que le sigue por
        ``value`` (serializado como JSON). Si el marcador no existe o el valor ya
        coincide, devuelve el HTML sin cambios. Se usa para reescribir
        ``tenantId`` y ``apiBaseUrl`` del ``#omnibotia-config`` al servirse.
        """
        idx = html.find(marker)
        if idx == -1:
            return html
        # Localiza el valor JSON (string) que sigue al marcador.
        start = idx + len(marker)
        while start < len(html) and html[start] in " \t":
            start += 1
        if start >= len(html) or html[start] != '"':
            return html
        end = start + 1
        while end < len(html) and html[end] != '"':
            end += 1
        if end >= len(html):
            return html
        current = html[start + 1 : end]
        if current == value:
            return html
        # ``end`` apunta a la comilla de cierre del valor; se consume para no
        # dejar un JSON malformado (``"apiBaseUrl":"valor""``).
        return html[:start] + json.dumps(value) + html[end + 1 :]

    @classmethod
    def _rewrite_embed_config(
        cls, html: str, *, tenant_id: uuid.UUID, origin: str
    ) -> str:
        """Reescribe ``tenantId``, ``apiBaseUrl`` y el ``src`` de ``embed.js``.

        El HTML se compila y despliega con un ``tenantId`` y un ``apiBaseUrl``
        deterministas (``{tenant}.clientes.omni2.app``). Al servirse, el tenant
        se resuelve por ``Host`` y el origen real puede diferir (localhost, túnel
        ngrok o dominio personalizado). Se reescriben ambos valores al tenant y
        origen con los que el navegador accedió a la página, de modo que el
        widget/portal apunte siempre al tenant y origen correctos
        (comportamiento multi-tenant correcto, sin hard-code).

        Además se reescribe el ``src`` del ``<script src=".../static/embed.js">``
        al mismo ``origin`` del request. El ``src`` se hornea en el HTML en el
        despliegue con el esquema y puerto del CDN configurado (p. ej.
        ``http://escobar.clientes.omni2.app/static/embed.js``), que al servirse
        por HTTPS sin puerto provoca **mixed-content** (el navegador bloquea el
        script). Al reescribirlo al origen real se elimina el bloqueo y el SDK
        se carga siempre desde el mismo origen que sirvió la página.
        """
        html = cls._rewrite_json_value(
            html, marker='"tenantId":', value=str(tenant_id)
        )
        html = cls._rewrite_json_value(html, marker='"apiBaseUrl":', value=origin)
        html = cls._rewrite_embed_src(html, origin=origin)
        return html

    @classmethod
    def _rewrite_embed_src(cls, html: str, *, origin: str) -> str:
        """Reescribe el ``src`` del ``<script .../static/embed.js>`` al ``origin``.

        Localiza el atributo ``src`` del script de ``embed.js`` y sustituye su
        valor por ``f"{origin}/static/embed.js"``. Si no se encuentra o el valor
        ya coincide, devuelve el HTML sin cambios.
        """
        marker = "/static/embed.js"
        idx = html.find(marker)
        if idx == -1:
            return html
        # Retrocede hasta el ``src="`` que precede al marcador.
        start = idx
        while start > 0 and html[start] != '"':
            start -= 1
        if start <= 0 or html[start] != '"':
            return html
        # ``start`` apunta a la comilla de apertura del valor del ``src``.
        current = html[start + 1 : idx]
        value = f"{origin}{marker}"
        if current == value:
            return html
        # Sustituye el valor completo del ``src`` (incluido el marcador) por el
        # nuevo origen. ``end`` apunta al final del marcador para no duplicarlo.
        end = idx + len(marker)
        return html[: start + 1] + value + html[end:]

    def serve(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        version: int,
        origin: str = "",
    ) -> str:
        """Devuelve el HTML compilado de la versión de una landing (serving CDN).

        Recupera el despliegue de la versión solicitada, siempre acotado al
        ``tenant_id`` (defensa en profundidad sobre RLS). Versión inexistente o
        de otro tenant → :class:`NotFoundError` (404), sin distinguir el motivo.

        Si se provee ``origin`` (origen del request), se reescribe el
        ``apiBaseUrl`` del ``#omnibotia-config`` para que el widget apunte al
        mismo origen que sirvió la página (localhost, túnel o dominio real).
        """
        deployment = self._repository.get_by_landing_version(
            tenant_id=tenant_id, landing_id=landing_id, version=version
        )
        if deployment is None or not deployment.html:
            raise NotFoundError(
                "Versión de landing no encontrada en el CDN",
                operation="cdn.serve",
                context={
                    "tenant_id": str(tenant_id),
                    "landing_id": str(landing_id),
                    "version": version,
                },
            )
        html = deployment.html
        if origin:
            html = self._rewrite_embed_config(
                html, tenant_id=tenant_id, origin=origin
            )
        self._logger.info(
            "cdn.served",
            message="Landing servida desde el CDN",
            tenant_id=str(tenant_id),
            landing_id=str(landing_id),
            version=str(version),
            origin=origin,
        )
        return html
