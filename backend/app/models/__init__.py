"""Modelos ORM (reglas CLAUDE: UUIDv4, tupla sync, RLS multi-tenant).

Importar este paquete registra los modelos de ``app.models`` en
``Base.metadata`` (necesario para ``create_all`` y Alembic autogenerate).

Los modelos del subsistema bot (``app.bot.models``) NO se re-exportan aquí de
forma eager: ``app.bot.models`` importa ``app.models.base``, y un re-export
eager provocaría un ciclo de importación (paquete parcialmente inicializado).
Se resuelven de forma perezosa vía ``__getattr__`` (PEP 562) y quedan
registrados en ``Base.metadata`` cuando se importan a través del arranque DI
(``app.core.di`` → ``app.bot.models``) antes de cualquier ``create_all``.
"""

from __future__ import annotations

import importlib
from typing import Any

from app.models.ads import AdCampaign
from app.models.analytics_event import AnalyticsEvent
from app.models.audit_log import AuditLog
from app.models.bot_documents import BotDocument, BotDocumentChunk
from app.models.bot_keywords import BotKeyword
from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)
from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotContact,
    BotIntervention,
    BotMaintenanceConfig,
    BotNavigationTree,
    BotTemplate,
)
from app.models.bot_synonyms import BotSynonym
from app.models.cdn_deployment import CdnDeployment
from app.models.crm import (
    CrmDeal,
    CrmDealStage,
    CrmDealStageChange,
    CrmSlaPolicy,
    CrmTask,
)
from app.models.landing import TenantLanding
from app.models.marketplace_template import MarketplaceTemplate
from app.models.portal_page import PortalPage
from app.models.pseo_batch import PseoBatch
from app.models.pseo_host import PseoHost
from app.models.pseo_page import PseoPage
from app.models.schema import DeveloperSchema
from app.models.schema_version import SchemaVersion
from app.models.tenant import Tenant, TenantOAuthToken
from app.models.tenant_config import (
    BotRebrandingConfig,
    CatalogItem,
    ContentItem,
    TenantAppearance,
    TenantChannel,
)
from app.models.user import Role, TenantMembership, User
from app.models.workflow import Appointment, AppointmentReminder, Lead, PaymentTransaction, Quote

# Modelos del bot que se resuelven de forma perezosa (ver docstring del módulo).
_BOT_MODEL_NAMES = frozenset({"BotCompanyProvider", "BotConversation", "BotMessage", "BotQueueMeta"})

__all__ = [
    "AdCampaign",
    "Appointment",
    "AppointmentReminder",
    "AnalyticsEvent",
    "AuditLog",
    "Base",
    "BotCampaign",
    "BotCampaignRecipient",
    "BotDocument",
    "BotDocumentChunk",
    "BotCompanyProvider",
    "BotContact",
    "BotConversation",
    "BotIntervention",
    "BotKeyword",
    "BotMaintenanceConfig",
    "BotMessage",
    "BotRebrandingConfig",
    "BotNavigationTree",
    "BotQueueMeta",
    "BotSynonym",
    "BotTemplate",
    "CatalogItem",
    "CdnDeployment",
    "ContentItem",
    "CrmDeal",
    "CrmDealStage",
    "CrmDealStageChange",
    "CrmSlaPolicy",
    "CrmTask",
    "DeveloperSchema",
    "JSONType",
    "Lead",
    "MarketplaceTemplate",
    "PaymentTransaction",
    "PortalPage",
    "PseoBatch",
    "PseoHost",
    "PseoPage",
    "Quote",
    "Role",
    "SchemaVersion",
    "SyncTupleMixin",
    "Tenant",
    "TenantAppearance",
    "TenantChannel",
    "TenantLanding",
    "TenantMembership",
    "TenantOAuthToken",
    "TenantScopedMixin",
    "TimestampsMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]


def __getattr__(name: str) -> Any:
    """Resolución perezosa de los modelos del bot (evita el ciclo de importación)."""
    if name in _BOT_MODEL_NAMES:
        return getattr(importlib.import_module("app.bot.models"), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
