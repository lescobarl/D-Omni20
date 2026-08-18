"""Puertos (ABC) de la capa de servicios — inversión de dependencias.

Los servicios dependen de interfaces (repositorios, compilador, logger) que se
inyectan desde el composition root; nunca instancian implementaciones con
``new`` (regla CLAUDE: NO ``new`` en lógica de negocio).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import Any

from app.schemas.audit import AuditLogRead
from app.schemas.common import Page
from app.schemas.landing import LandingCompileRequest, LandingCompileResponse, LandingCreate, LandingRead, LandingUpdate


class ICompilerService(ABC):
    """Compilador de configuración → HTML (motor minimal funcional)."""

    @abstractmethod
    def compile(self, *, config: dict[str, Any], template_name: str = "default") -> str: ...


class IAuditService(ABC):
    """Log de auditoría estructurado (append-only, con correlación de request)."""

    @abstractmethod
    def record(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> Page[AuditLogRead]: ...


class ILandingService(ABC):
    """Caso de uso de landings (CRUD + publicar + compilar)."""

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, data: LandingCreate) -> LandingRead: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> LandingRead: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> Page[LandingRead]: ...

    @abstractmethod
    def update(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, data: LandingUpdate) -> LandingRead: ...

    @abstractmethod
    def delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> None: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool) -> LandingRead: ...

    @abstractmethod
    def compile(
        self,
        *,
        tenant_id: uuid.UUID,
        data: LandingCompileRequest,
    ) -> LandingCompileResponse: ...
