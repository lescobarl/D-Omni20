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

import time
import uuid

from app.config.settings import Settings
from app.core.errors import NotFoundError
from app.core.logging import ILogger
from app.repositories.interfaces import ICdnDeploymentRepository, ILandingRepository
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
        compiler: ICompilerService,
        settings: Settings,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._repository = repository
        self._landing_repository = landing_repository
        self._compiler = compiler
        self._settings = settings
        self._audit = audit
        self._logger = logger

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
        base_url = self._settings.cdn_base_url.rstrip("/")
        url = f"{base_url}/{landing_id}/v{version}"
        html = self._compiler.compile(config=landing.config)
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
