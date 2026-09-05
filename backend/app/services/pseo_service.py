"""Servicio de persistencia versionada y serving público PSEO (Fase D).

Contrato:
- ``persist_matrix`` es idempotente por hash de matriz (config + filas +
  versión de plantilla): re-ejecutar la misma matriz no crea un lote ni
  versiones nuevas de páginas. El HTML vive en la BD (sin filesystem) y cada
  página tiene una ``version`` incremental que solo sube si el HTML cambió.
- ``serve_page`` / sitemap exponen únicamente páginas publicadas del tenant
  resuelto por ``Host``; si no existe devuelven ``None`` (el router decide 404).
- Sin doble escape: el HTML ya viene pre-escapado por ``DataMatrixService``.
- El servicio depende de interfaces (repositorios, auditoría, logger) y de
  ``Settings`` inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any
from urllib.parse import urlparse

from app.config.settings import Settings
from app.core.logging import ILogger
from app.models.pseo_page import PseoPage
from app.repositories.interfaces import (
    IPseoBatchRepository,
    IPseoHostRepository,
    IPseoPageRepository,
)
from app.schemas.pseo import PseoBatchRead
from app.services.interfaces import (
    IAuditService,
    IPseoService,
    ResolvedPage,
)

_TEMPLATE_VERSION = "pseo"


class PseoService(IPseoService):
    def __init__(
        self,
        *,
        batch_repository: IPseoBatchRepository,
        host_repository: IPseoHostRepository,
        page_repository: IPseoPageRepository,
        settings: Settings,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._batch_repository = batch_repository
        self._host_repository = host_repository
        self._page_repository = page_repository
        self._settings = settings
        self._audit = audit
        self._logger = logger

    # -- utilidades ----------------------------------------------------------
    @staticmethod
    def _build_slug_path(city: str, service_slug: str) -> str:
        """``city/service_slug`` — ambos ya validados como slugs estrictos."""
        return f"{city}/{service_slug}"

    def _compute_matrix_hash(
        self, *, template_config: dict[str, Any], resolved_pages: list[ResolvedPage]
    ) -> str:
        rows = [
            {
                "city": page.city,
                "service_slug": page.service_slug,
                "service_name": page.service_name,
                "offer_price": page.offer_price,
            }
            for page in resolved_pages
        ]
        payload = {
            "template_config": template_config,
            "rows": rows,
            "template_version": _TEMPLATE_VERSION,
        }
        canonical = json.dumps(
            payload, sort_keys=True, ensure_ascii=True, separators=(",", ":")
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _canonical_url(self, *, tenant_id: uuid.UUID, slug_path: str) -> str:
        # Fail-closed: solo hosts activos y no eliminados participan en el
        # canonical. Un host ``pending`` (dominio aún sin verificar) no debe
        # aparecer como URL canónica de las páginas servidas.
        active_host = next(
            (
                h
                for h in self._host_repository.list_by_tenant(tenant_id=tenant_id)
                if not h.deleted and h.status == "active"
            ),
            None,
        )
        if active_host is None:
            return ""
        scheme = urlparse(self._settings.cdn_base_url).scheme or (
            "https" if self._settings.is_production else "http"
        )
        return f"{scheme}://{active_host.host}/{slug_path}"

    def _cdn_origin(self) -> str:
        """Origen (``scheme://netloc``) de ``cdn_base_url`` para servir el embed."""
        parsed = urlparse(self._settings.cdn_base_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return ""

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

    def _inject_embed(
        self, *, html: str, tenant_id: uuid.UUID, slug_path: str
    ) -> str:
        """Inyecta canonical + config del embed + ``embed.js`` antes de ``</head>``.

        - ``<link rel="canonical">`` con la URL canónica de la página.
        - ``<script id="omnibotia-config" type="application/json">`` con
          ``tenantId`` y ``apiBaseUrl`` (JSON seguro para ``<script>``).
        - ``<script src="{cdn}/static/embed.js" defer>`` (Fase C).

        No re-renderiza datos de usuario: el HTML ya llega pre-escapado por
        ``DataMatrixService`` y el JSON de config se serializa con
        ``_script_safe_json`` (anti-``</script>``).
        """
        if "</head>" not in html:
            return html

        head = ""
        canonical = self._canonical_url(tenant_id=tenant_id, slug_path=slug_path)
        if canonical:
            head += f'<link rel="canonical" href="{canonical}">\n'

        embed_config = self._script_safe_json(
            {"tenantId": str(tenant_id), "apiBaseUrl": self._cdn_origin()}
        )
        head += (
            f'<script id="omnibotia-config" type="application/json">'
            f"{embed_config}</script>\n"
        )

        cdn_origin = self._cdn_origin()
        if cdn_origin:
            head += f'<script src="{cdn_origin}/static/embed.js" defer></script>\n'

        return html.replace("</head>", f"{head}</head>", 1)

    # -- persistencia versionada (idempotente) --------------------------------
    def persist_matrix(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        template_config: dict[str, Any],
        resolved_pages: list[ResolvedPage],
    ) -> PseoBatchRead:
        started = time.perf_counter()
        matrix_hash = self._compute_matrix_hash(
            template_config=template_config, resolved_pages=resolved_pages
        )

        existing = self._batch_repository.get_by_hash(
            tenant_id=tenant_id, matrix_hash=matrix_hash
        )
        if existing is not None:
            duration_ms = round((time.perf_counter() - started) * 1000, 3)
            self._audit.record(
                tenant_id=tenant_id,
                operation="pseo.batch.persist",
                entity_type="pseo_batch",
                entity_id=str(existing.id),
                details={
                    "matrix_hash": matrix_hash,
                    "idempotent": True,
                    "duration_ms": duration_ms,
                },
            )
            self._logger.info(
                "pseo.batch.idempotent",
                message="Matriz sin cambios: lote PSEO no regenerado",
                tenant_id=str(tenant_id),
                campaign_id=str(campaign_id),
                matrix_hash=matrix_hash,
                batch_id=str(existing.id),
                duration_ms=str(duration_ms),
            )
            return PseoBatchRead.model_validate(existing)

        batch = self._batch_repository.create(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            matrix_hash=matrix_hash,
            template_version=_TEMPLATE_VERSION,
            page_count=len(resolved_pages),
        )

        for page in resolved_pages:
            slug_path = self._build_slug_path(page.city, page.service_slug)
            compiled_html = page.html or ""
            # Fase C + E: canonical + embed (omnibotia-config + embed.js) en el
            # <head> de cada página persistida. La inyección ocurre DESPUÉS del
            # hash de matriz (idempotencia intacta) y antes del upsert.
            compiled_html = self._inject_embed(
                html=compiled_html, tenant_id=tenant_id, slug_path=slug_path
            )
            existing_page = self._page_repository.get_by_slug_path(
                tenant_id=tenant_id, slug_path=slug_path
            )
            if existing_page is not None:
                version = (
                    existing_page.version + 1
                    if existing_page.compiled_html != compiled_html
                    else existing_page.version
                )
            else:
                version = 1
            self._page_repository.upsert(
                tenant_id=tenant_id,
                batch_id=batch.id,
                slug_path=slug_path,
                city=page.city,
                service_slug=page.service_slug,
                service_name=page.service_name,
                offer_price=page.offer_price,
                canonical_url=self._canonical_url(
                    tenant_id=tenant_id, slug_path=slug_path
                ),
                compiled_html=compiled_html,
                version=version,
            )

        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        self._audit.record(
            tenant_id=tenant_id,
            operation="pseo.batch.persist",
            entity_type="pseo_batch",
            entity_id=str(batch.id),
            details={
                "matrix_hash": matrix_hash,
                "idempotent": False,
                "page_count": len(resolved_pages),
                "duration_ms": duration_ms,
            },
        )
        self._logger.info(
            "pseo.batch.persisted",
            message="Lote PSEO persistido",
            tenant_id=str(tenant_id),
            campaign_id=str(campaign_id),
            matrix_hash=matrix_hash,
            batch_id=str(batch.id),
            pages=str(len(resolved_pages)),
            duration_ms=str(duration_ms),
        )
        return PseoBatchRead.model_validate(batch)

    # -- serving público ------------------------------------------------------
    def serve_page(self, *, tenant_id: uuid.UUID, slug_path: str) -> PseoPage | None:
        """Página publicada del tenant o ``None`` (el router decide el 404)."""
        return self._page_repository.get_by_slug_path(
            tenant_id=tenant_id, slug_path=slug_path, published=True
        )

    def sitemap_pages(
        self, *, tenant_id: uuid.UUID, offset: int, limit: int
    ) -> list[PseoPage]:
        return self._page_repository.list_published(
            tenant_id=tenant_id, offset=offset, limit=limit
        )

    def count_pages(self, *, tenant_id: uuid.UUID) -> int:
        return self._page_repository.count_published(tenant_id=tenant_id)
