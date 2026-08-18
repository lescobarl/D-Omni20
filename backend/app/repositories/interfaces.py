"""Puertos (ABC) de repositorios — inversión de dependencias (regla CLAUDE: DI).

La lógica de negocio depende de estas interfaces, nunca de implementaciones
concretas. Las implementaciones concretas viven en
``app.repositories.sqlalchemy_repositories`` y se inyectan desde el
composition root (``app.api.deps``).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import Any

from app.models.audit_log import AuditLog
from app.models.landing import TenantLanding
from app.models.tenant import Tenant


class ITenantRepository(ABC):
    """Acceso a tenants (raíz del multi-tenancy)."""

    @abstractmethod
    def get_by_id(self, tenant_id: uuid.UUID) -> Tenant | None: ...

    @abstractmethod
    def get_by_slug(self, slug: str) -> Tenant | None: ...

    @abstractmethod
    def create(self, slug: str, name: str) -> Tenant: ...

    @abstractmethod
    def list_all(self) -> list[Tenant]: ...


class ILandingRepository(ABC):
    """Acceso a landings SIEMPRE acotado al tenant (defensa en profundidad).

    Toda query incluye ``tenant_id`` y filtra ``deleted=False``; en PostgreSQL
    RLS refuerza el mismo límite a nivel de base de datos.
    """

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID, name: str, config: dict[str, Any]) -> TenantLanding: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def get_by_campaign(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[TenantLanding], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> TenantLanding | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> bool: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool) -> TenantLanding | None: ...


class IAuditRepository(ABC):
    """Log de auditoría estructurado (append-only, inmutable)."""

    @abstractmethod
    def record(
        self,
        *,
        tenant_id: uuid.UUID | None,
        user_id: str | None,
        request_id: str,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> tuple[list[AuditLog], int]: ...
