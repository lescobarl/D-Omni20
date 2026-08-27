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
"""

from abc import ABC, abstractmethod

from app.schemas.workflow import LeadRead


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
