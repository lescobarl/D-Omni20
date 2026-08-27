"""Modelos ORM (reglas CLAUDE: UUIDv4, tupla sync, RLS multi-tenant).

Importar este paquete registra todos los modelos en ``Base.metadata``
(necesario para ``create_all`` y Alembic autogenerate).
"""

from app.models.analytics_event import AnalyticsEvent
from app.models.audit_log import AuditLog
from app.models.base import Base, JSONType, SyncTupleMixin, TenantScopedMixin, TimestampsMixin, UUIDPrimaryKeyMixin
from app.models.cdn_deployment import CdnDeployment
from app.models.landing import TenantLanding
from app.models.marketplace_template import MarketplaceTemplate
from app.models.pseo_batch import PseoBatch
from app.models.pseo_host import PseoHost
from app.models.pseo_page import PseoPage
from app.models.schema import DeveloperSchema
from app.models.schema_version import SchemaVersion
from app.models.tenant import Tenant, TenantOAuthToken
from app.models.workflow import Appointment, AppointmentReminder, Lead, PaymentTransaction, Quote

__all__ = [
    "Appointment",
    "AppointmentReminder",
    "AnalyticsEvent",
    "AuditLog",
    "Base",
    "CdnDeployment",
    "DeveloperSchema",
    "JSONType",
    "Lead",
    "MarketplaceTemplate",
    "PaymentTransaction",
    "PseoBatch",
    "PseoHost",
    "PseoPage",
    "Quote",
    "SchemaVersion",
    "SyncTupleMixin",
    "Tenant",
    "TenantLanding",
    "TenantOAuthToken",
    "TenantScopedMixin",
    "TimestampsMixin",
    "UUIDPrimaryKeyMixin",
]
