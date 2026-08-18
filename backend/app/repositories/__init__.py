"""Repositorios: puertos (interfaces) e implementaciones SQLAlchemy.

La composición (qué implementación usar) ocurre en ``app.api.deps``,
nunca en la lógica de negocio.
"""

from app.repositories.interfaces import IAuditRepository, ILandingRepository, ITenantRepository
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyLandingRepository,
    SqlAlchemyTenantRepository,
)

__all__ = [
    "IAuditRepository",
    "ILandingRepository",
    "ITenantRepository",
    "SqlAlchemyAuditRepository",
    "SqlAlchemyLandingRepository",
    "SqlAlchemyTenantRepository",
]
