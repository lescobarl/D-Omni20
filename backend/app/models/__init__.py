"""Modelos ORM (reglas CLAUDE: UUIDv4, tupla sync, RLS multi-tenant).

Importar este paquete registra todos los modelos en ``Base.metadata``
(necesario para ``create_all`` y Alembic autogenerate).
"""

from app.models.audit_log import AuditLog
from app.models.base import Base, JSONType, SyncTupleMixin, TenantScopedMixin, TimestampsMixin, UUIDPrimaryKeyMixin
from app.models.landing import TenantLanding
from app.models.tenant import Tenant

__all__ = [
    "AuditLog",
    "Base",
    "JSONType",
    "SyncTupleMixin",
    "Tenant",
    "TenantLanding",
    "TenantScopedMixin",
    "TimestampsMixin",
    "UUIDPrimaryKeyMixin",
]
