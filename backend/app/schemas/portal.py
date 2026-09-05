"""Esquemas del Portal del Cliente (C-3) — login y autoservicio.

Contrato:
- ``extra="forbid"`` en toda petición (fail-fast ante payloads desconocidos).
- El login valida el correo con el mismo patrón de :mod:`app.schemas.workflow`.
- El resumen del portal reutiliza los read models de workflows (pagos, leads,
  cotizaciones y citas) y de CRM (oportunidades abiertas y próximos pasos) —
  sin duplicar esquemas (regla CLAUDE).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.crm import DealRead, TaskRead
from app.schemas.workflow import (
    AppointmentRead,
    LeadRead,
    PaymentRead,
    QuoteRead,
)

_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class PortalLoginRequest(BaseModel):
    """Solicitud de acceso al portal: el correo del comprador final."""

    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=1, max_length=255, pattern=_EMAIL_PATTERN)


class PortalLoginResponse(BaseModel):
    """Credenciales del portal: token firmado + vigencia."""

    token: str
    email: str
    expires_at: datetime


class PortalOpportunityRead(DealRead):
    """Oportunidad abierta del cliente para el portal.

    Reutiliza :class:`DealRead` (sin duplicar el contrato CRM) y añade el
    nombre legible de la etapa para la tarjeta "Mis oportunidades".
    """

    stage_name: str | None = None


class PortalSummaryRead(BaseModel):
    """Estado del pedido/oportunidad del cliente.

    Reutiliza los read models de workflows y CRM para no duplicar contratos:
    pagos, leads, cotizaciones, citas, oportunidades abiertas y próximos
    pasos del correo autenticado.
    """

    email: str
    payments: list[PaymentRead] = Field(default_factory=list)
    leads: list[LeadRead] = Field(default_factory=list)
    quotes: list[QuoteRead] = Field(default_factory=list)
    appointments: list[AppointmentRead] = Field(default_factory=list)
    opportunities: list[PortalOpportunityRead] = Field(default_factory=list)
    next_steps: list[TaskRead] = Field(default_factory=list)
