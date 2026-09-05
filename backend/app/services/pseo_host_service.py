"""Servicio de dominios personalizados del tenant (CRUD + verificación DNS).

Ciclo de vida:
- ``request_domain``: registra un dominio en estado ``pending`` con un token de
  verificación aleatorio (``secrets.token_urlsafe``).
- ``verify_domain``: verifica la propiedad vía :class:`IDnsVerifier` (TXT
  ``_omni2-verify.{host}``) y lo pasa a ``active`` con ``verified_at``
  (idempotente si ya está activo).
- ``remove_domain``: soft-delete; re-solicitarlo reactiva la fila (evita violar
  la ``UniqueConstraint`` global de ``host``).

Regla CLAUDE (DI y defensa en profundidad):
- Solo los hosts ``active`` son servidos públicamente (fail-closed en la
  resolución pública).
- El dominio es único globalmente → duplicados no eliminados elevan
  :class:`ConflictError`; formato inválido → :class:`InputValidationError`.
- Toda operación está acotada al ``tenant_id`` activo y se registra en el log
  de auditoría estructurado.
- El servicio depende de interfaces inyectadas desde el composition root
  (nunca ``new``): host_repository, dns_verifier, audit, logger.
"""

from __future__ import annotations

import re
import secrets
import uuid

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.repositories.interfaces import IPseoHostRepository
from app.schemas.pseo import PseoHostRead
from app.services.interfaces import IAuditService, IDnsVerifier, IPseoHostService

# Dominio o subdominio, opcionalmente con puerto (dev local: localhost:8000).
# - Etiquetas alfanuméricas separadas por "." sin guiones al inicio/fin.
# - TLD de 2..63 letras; puerto opcional ``:1``..``:65535``.
_HOST_PATTERN = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?$"
    r"|^localhost(?::\d{1,5})?$"
)


def _normalize_host(host: str) -> str:
    """Normaliza y valida la forma canónica del host a registrar.

    Tolera esquema (``https://``/``http://``), espacios y barra final por
    ergonomía de entrada, pero rechaza formatos claramente inválidos.
    """
    value = host.strip().lower()
    for scheme in ("https://", "http://"):
        if value.startswith(scheme):
            value = value[len(scheme) :]
    value = value.rstrip("/")
    if not value:
        raise InputValidationError(
            "El dominio no puede estar vacío",
            operation="pseo_hosts.request",
            context={"host": host},
        )
    if len(value) > 255:
        raise InputValidationError(
            "El dominio no puede superar los 255 caracteres",
            operation="pseo_hosts.request",
            context={"host": host},
        )
    if _HOST_PATTERN.fullmatch(value) is None:
        raise InputValidationError(
            "Formato de dominio inválido "
            "(ej. `portal.miempresa.com` o `localhost:8000`)",
            operation="pseo_hosts.request",
            context={"host": host},
        )
    return value


class PseoHostService(IPseoHostService):
    def __init__(
        self,
        *,
        host_repository: IPseoHostRepository,
        dns_verifier: IDnsVerifier,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._host_repository = host_repository
        self._dns_verifier = dns_verifier
        self._audit = audit
        self._logger = logger

    def request_domain(self, *, tenant_id: uuid.UUID, host: str) -> PseoHostRead:
        normalized = _normalize_host(host)

        existing = self._host_repository.find_by_host(host=normalized)
        if existing is not None and not existing.deleted:
            raise ConflictError(
                "El dominio ya está registrado",
                operation="pseo_hosts.request",
                context={"tenant_id": str(tenant_id), "host": normalized},
            )

        verify_token = secrets.token_urlsafe(32)
        if existing is not None and existing.deleted:
            row = self._host_repository.reactivate(
                host=normalized, tenant_id=tenant_id, verify_token=verify_token
            )
            if row is None:  # pragma: no cover - carrera improbable
                raise NotFoundError(
                    "El dominio no existe",
                    operation="pseo_hosts.request",
                    context={"tenant_id": str(tenant_id), "host": normalized},
                )
        else:
            row = self._host_repository.create(
                tenant_id=tenant_id, host=normalized, verify_token=verify_token
            )

        self._audit.record(
            tenant_id=tenant_id,
            operation="pseo_hosts.request",
            entity_type="pseo_host",
            entity_id=str(row.id),
            details={"host": normalized, "status": row.status},
        )
        self._logger.info(
            "pseo_hosts.requested",
            message="Dominio personalizado registrado (pendiente de verificación DNS)",
            pseo_host_id=str(row.id),
            tenant_id=str(tenant_id),
            host=normalized,
        )
        return PseoHostRead.model_validate(row)

    def list_domains(self, *, tenant_id: uuid.UUID) -> list[PseoHostRead]:
        rows = self._host_repository.list_by_tenant(tenant_id=tenant_id)
        return [PseoHostRead.model_validate(row) for row in rows]

    def verify_domain(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHostRead:
        row = self._host_repository.get_by_id(tenant_id=tenant_id, host_id=host_id)
        if row is None:
            raise NotFoundError(
                "Dominio no encontrado",
                operation="pseo_hosts.verify",
                context={"tenant_id": str(tenant_id), "host_id": str(host_id)},
            )
        if row.status == "active":
            # Idempotente: ya verificado y activo.
            return PseoHostRead.model_validate(row)

        if row.verify_token is None:
            raise InputValidationError(
                "El dominio no tiene token de verificación",
                operation="pseo_hosts.verify",
                context={"tenant_id": str(tenant_id), "host_id": str(host_id)},
            )

        verified = self._dns_verifier.verify_txt(
            host=row.host, expected=row.verify_token
        )
        if not verified:
            raise InputValidationError(
                "No se pudo verificar la propiedad del dominio: agrega el registro "
                f"TXT `_omni2-verify.{row.host.split(':', 1)[0]}` con el token indicado",
                operation="pseo_hosts.verify",
                context={
                    "tenant_id": str(tenant_id),
                    "host_id": str(host_id),
                    "host": row.host,
                },
            )

        active = self._host_repository.mark_verified(
            tenant_id=tenant_id, host_id=host_id
        )
        if active is None:  # pragma: no cover - carrera improbable
            raise NotFoundError(
                "Dominio no encontrado",
                operation="pseo_hosts.verify",
                context={"tenant_id": str(tenant_id), "host_id": str(host_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="pseo_hosts.verify",
            entity_type="pseo_host",
            entity_id=str(host_id),
            details={"host": row.host, "status": "active"},
        )
        self._logger.info(
            "pseo_hosts.verified",
            message="Dominio verificado y activado para serving público",
            pseo_host_id=str(host_id),
            tenant_id=str(tenant_id),
            host=row.host,
        )
        return PseoHostRead.model_validate(active)

    def remove_domain(self, *, tenant_id: uuid.UUID, host_id: uuid.UUID) -> None:
        row = self._host_repository.get_by_id(tenant_id=tenant_id, host_id=host_id)
        if row is None:
            raise NotFoundError(
                "Dominio no encontrado",
                operation="pseo_hosts.remove",
                context={"tenant_id": str(tenant_id), "host_id": str(host_id)},
            )
        deleted = self._host_repository.soft_delete(
            tenant_id=tenant_id, host_id=host_id
        )
        if not deleted:
            raise NotFoundError(
                "Dominio no encontrado",
                operation="pseo_hosts.remove",
                context={"tenant_id": str(tenant_id), "host_id": str(host_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="pseo_hosts.remove",
            entity_type="pseo_host",
            entity_id=str(host_id),
            details={"host": row.host, "deleted": True},
        )
        self._logger.info(
            "pseo_hosts.removed",
            message="Dominio personalizado eliminado (soft delete)",
            pseo_host_id=str(host_id),
            tenant_id=str(tenant_id),
            host=row.host,
        )
