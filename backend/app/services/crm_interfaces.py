"""Puertos (ABC) de adaptadores CRM — inversión de dependencias (Fase 2 del backlog).

Los adaptadores encapsulan el *formato de payload* y *autenticación* de cada
CRM destino, de modo que :class:`CrmWebhookSender` (en ``providers.py``) solo
orquesta el envío y el reintento con backoff. El contrato de ``send_lead``:

- Devuelve ``True`` si el CRM respondió 2xx (entregado).
- Devuelve ``False`` si el adaptador no está configurado (URL vacía).
- Lanza :class:`httpx.HTTPStatusError` cuando el CRM responde ``status >= 400``
  (error de la contraparte; reintentable).
- Lanza :class:`httpx.HTTPError` ante fallos de red / timeout (reintentable).

El *emisor* es quien registra el log estructurado (eventos ``crm_*``); los
adaptadores no loguean nada para evitar duplicidad de trazas.

Además de los adaptadores de salida, este módulo declara el *contrato de
eventos de orquestación* (:class:`ICrmEventPublisher`) y sus payloads
(:class:`LeadNeedsHumanEvent`, :class:`PaymentConfirmedEvent`). El editor de
workflows publica estos eventos y el subsistema CRM los consume para
auto-crear oportunidades y sugerir cierres — sin importaciones cruzadas
(regla CLAUDE: DI).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.schemas.workflow import LeadRead


@dataclass(frozen=True)
class LeadNeedsHumanEvent:
    """Un lead requiere atención humana (``needs_human``) → auto-crear Deal+Task.

    Payload desacoplado: transporta solo datos, nunca referencias a servicios.
    """

    tenant_id: uuid.UUID
    lead_id: uuid.UUID
    name: str
    email: str
    phone: str | None
    source: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class PaymentConfirmedEvent:
    """Un pago fue confirmado (``checkout.session.completed``) → sugerir cierre.

    Payload desacoplado: transporta solo datos, nunca referencias a servicios.
    """

    tenant_id: uuid.UUID
    payment_id: uuid.UUID
    customer_email: str | None
    customer_name: str | None
    amount_minor: int
    currency: str
    metadata: dict[str, Any]


class ICrmEventPublisher(ABC):
    """Puerto de publicación de eventos de orquestación hacia el subsistema CRM.

    El emisor es inyectado por DI (regla CLAUDE: DI) y consumido por el
    servicio de workflows; las implementaciones delegan en :class:`CrmService`.
    """

    @abstractmethod
    def publish_lead_needs_human(self, *, event: LeadNeedsHumanEvent) -> None:
        """Dispara la auto-creación de la oportunidad + tarea de seguimiento."""

    @abstractmethod
    def publish_payment_confirmed(self, *, event: PaymentConfirmedEvent) -> None:
        """Dispara la sugerencia de cierre ``Ganado`` sobre oportunidades abiertas."""


class ICrmAdapter(ABC):
    """Puerto de un adaptador hacia un CRM externo (regla CLAUDE: DI)."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Identificador del proveedor (``generic`` | ``hubspot`` | ``salesforce`` | ``zoho``)."""

    @abstractmethod
    def is_configured(self) -> bool:
        """True si hay URL de destino configurada (endpoint alcanzable)."""

    @abstractmethod
    def send_lead(self, *, lead: LeadRead) -> bool:
        """Entrega un prospecto al CRM. Ver contrato en el docstring del módulo."""

    @abstractmethod
    def close(self) -> None:
        """Libera recursos (cierra el cliente HTTP propio, si existe)."""
