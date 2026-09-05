"""Puertos (ABC) de la capa de servicios de workflows — inversión de dependencias.

Regla CLAUDE: los servicios dependen de interfaces (ABC), nunca de ``new``.
Aquí se definen los puertos de infraestructura externa (pasarela de pago,
render de cotizaciones PDF, calendario ICS, webhook de CRM, correo SMTP,
SMS, WhatsApp Cloud API y Google Calendar) además del caso de uso
:class:`IWorkflowService`.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.schemas.common import Page
from app.schemas.workflow import (
    AppointmentRead,
    AppointmentRequest,
    AppointmentResponse,
    CheckoutRequest,
    CheckoutResponse,
    LeadAttributionRead,
    LeadRead,
    LeadRequest,
    PaymentRead,
    QuoteRead,
    QuoteRequest,
    QuoteResponse,
)


# ---------------------------------------------------------------------------
# Resultados inmutables de la infraestructura externa
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CheckoutSessionResult:
    """Resultado de crear una sesión de checkout en la pasarela."""

    session_id: str
    checkout_url: str
    provider: str


@dataclass(frozen=True)
class QuoteDocumentResult:
    """Documento PDF generado para una cotización."""

    path: str
    url: str
    bytes_size: int


@dataclass(frozen=True)
class CalendarEventResult:
    """Evento de calendario (ICS) generado para una cita."""

    path: str
    url: str
    bytes_size: int


# ---------------------------------------------------------------------------
# Puertos de infraestructura externa
# ---------------------------------------------------------------------------


class IPaymentGateway(ABC):
    """Puerto de la pasarela de pagos (sandbox o Stripe en producción)."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Nombre del proveedor (``sandbox`` | ``stripe``)."""

    @abstractmethod
    def create_checkout_session(
        self,
        *,
        amount_minor: int,
        currency: str,
        customer_email: str | None,
        customer_name: str | None,
        success_url: str | None,
        cancel_url: str | None,
        metadata: dict[str, object] | None,
    ) -> CheckoutSessionResult:
        """Crea una sesión de checkout y devuelve la URL de redirección."""

    @abstractmethod
    def verify_webhook_signature(
        self, *, payload: bytes, signature: str | None
    ) -> bool:
        """Verifica la firma de un webhook entrante (HMAC en Stripe)."""

    def close(self) -> None:
        """Libera recursos (cliente HTTP) si los hubiera. No-op por defecto."""


class IQuoteRenderer(ABC):
    """Puerto para renderizar cotizaciones como documentos PDF."""

    @abstractmethod
    def render(self, *, quote: QuoteRead) -> QuoteDocumentResult:
        """Genera el PDF de una cotización y devuelve su ubicación."""


class ICalendarProvider(ABC):
    """Puerto para crear eventos de calendario (formato ICS, RFC 5545)."""

    @abstractmethod
    def create_event(self, *, appointment: AppointmentRead) -> CalendarEventResult:
        """Genera el archivo ICS de una cita y devuelve su ubicación."""


class ICrmWebhookSender(ABC):
    """Puerto para notificar prospectos al CRM externo vía webhook."""

    @abstractmethod
    def send_lead(self, *, lead: LeadRead) -> bool:
        """Envía el prospecto al CRM. Devuelve ``True`` si se notificó."""

    def close(self) -> None:
        """Libera recursos (cliente HTTP) si los hubiera. No-op por defecto."""


@dataclass(frozen=True)
class EmailAttachment:
    """Archivo adjunto de un correo (nombre, contenido y MIME type)."""

    filename: str
    content: bytes
    maintype: str = "application"
    subtype: str = "octet-stream"


class IEmailSender(ABC):
    """Puerto para enviar correos electrónicos vía SMTP."""

    @abstractmethod
    def send_email(
        self,
        *,
        to_email: str,
        subject: str,
        html_body: str | None = None,
        template_name: str | None = None,
        template_context: dict[str, Any] | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        """Envía un correo. Devuelve ``True`` si se entregó al servidor.

        Si ``html_body`` no se provee, el cuerpo se renderiza desde la plantilla
        ``template_name`` con ``template_context`` (vía un ``EmailTemplateService``
        inyectado). Si tampoco hay plantilla disponible, el envío se omite
        (``False``).
        """

    def close(self) -> None:
        """Libera recursos si los hubiera. No-op por defecto."""


class ISmsSender(ABC):
    """Puerto para enviar mensajes SMS (p. ej. Twilio)."""

    @abstractmethod
    def send_sms(self, *, to_phone: str, message: str) -> bool:
        """Envía un SMS. Devuelve ``True`` si se entregó al proveedor."""

    def close(self) -> None:
        """Libera recursos si los hubiera. No-op por defecto."""


class IWhatsAppSender(ABC):
    """Puerto para enviar mensajes de WhatsApp (Cloud API de Meta)."""

    @abstractmethod
    def send_template_message(
        self,
        *,
        to_phone: str,
        template_name: str,
        template_variables: dict[str, str],
    ) -> bool:
        """Envía un mensaje de plantilla. Devuelve ``True`` si se aceptó."""

    @abstractmethod
    def send_text(self, *, to_phone: str, text: str) -> bool:
        """Envía un mensaje de texto libre (ventana de servicio al cliente, 24h)."""

    @abstractmethod
    def verify_webhook_signature(
        self, *, payload: bytes, signature: str | None
    ) -> bool:
        """Valida la firma ``X-Hub-Signature-256`` de un webhook de Meta."""

    def close(self) -> None:
        """Libera recursos si los hubiera. No-op por defecto."""


class IMetaGraphMessagesSender(ABC):
    """Puerto para enviar mensajes vía la Graph API de Meta (Instagram/Messenger).

    Messenger y la Instagram Messaging API comparten el endpoint ``me/messages``
    de la Send API; el ``access_token`` (token de página para Messenger, token
    de cuenta profesional para Instagram) determina el ámbito del envío y el
    ``recipient_id`` es el id de ámbito del remitente del webhook.
    """

    @abstractmethod
    def send_text(self, *, recipient_id: str, text: str) -> bool:
        """Envía un mensaje de texto. Devuelve ``True`` si la API lo aceptó."""

    @abstractmethod
    def verify_webhook_signature(
        self, *, payload: bytes, signature: str | None
    ) -> bool:
        """Valida la firma ``X-Hub-Signature-256`` de un webhook de Meta."""

    def close(self) -> None:
        """Libera recursos si los hubiera. No-op por defecto."""


class IWhatsAppSenderFactory(ABC):
    """Fábrica de senders de WhatsApp por tenant (Fase 6.1 — multi-WABA por empresa).

    Resuelve el sender con las credenciales del canal WhatsApp del tenant
    (``tenant_channels``) para evitar el fallback global de credenciales.
    """

    @abstractmethod
    def resolve_sender_for_tenant(self, *, tenant_id: uuid.UUID) -> IWhatsAppSender | None:
        """Resuelve el sender del tenant. None si no hay canal WhatsApp habilitado con credenciales."""


class IGoogleCalendarProvider(ICalendarProvider):
    """Puerto de Google Calendar (OAuth 2.0 + REST) sobre el ICS local."""

    @property
    @abstractmethod
    def is_configured(self) -> bool:
        """True cuando existen credenciales de OAuth 2.0 configuradas."""

    @property
    @abstractmethod
    def is_authenticated(self) -> bool:
        """True cuando hay un token de acceso vigente en memoria."""

    @property
    @abstractmethod
    def authorization_url(self) -> str | None:
        """URL de consentimiento de Google (None si no está configurado)."""

    @abstractmethod
    def authorization_url_for(self, *, tenant_id: uuid.UUID | None = None) -> str | None:
        """URL de consentimiento con el tenant embebido en ``state`` (None si no está configurado)."""

    @abstractmethod
    def authenticate(self, *, auth_code: str, tenant_id: uuid.UUID | None = None) -> bool:
        """Intercambia el código de autorización por un token de acceso y lo persiste cifrado (Fase 3)."""

    @abstractmethod
    def create_calendar_event(self, *, appointment: AppointmentRead) -> str | None:
        """Crea el evento real en Google Calendar y devuelve su ID (o None)."""


# ---------------------------------------------------------------------------
# Caso de uso
# ---------------------------------------------------------------------------


class IWorkflowService(ABC):
    """Caso de uso de workflows: checkout, leads, cotizaciones y citas.

    Todas las operaciones están acotadas al tenant (defensa en profundidad).
    """

    # ---- Checkout / pagos -------------------------------------------------
    @abstractmethod
    def create_checkout(
        self, *, tenant_id: uuid.UUID, data: CheckoutRequest
    ) -> CheckoutResponse:
        """Inicia un checkout directo (sesión en la pasarela + transacción)."""

    @abstractmethod
    def confirm_checkout(
        self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID
    ) -> PaymentRead:
        """Confirma manualmente un pago sandbox pendiente (idempotente)."""

    @abstractmethod
    def handle_checkout_webhook(
        self, *, tenant_id: uuid.UUID, payload: bytes, signature: str | None
    ) -> PaymentRead | None:
        """Procesa un webhook de la pasarela (Stripe) y actualiza el pago."""

    @abstractmethod
    def get_payment(
        self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID
    ) -> PaymentRead:
        """Devuelve una transacción de pago por su ID."""

    @abstractmethod
    def list_payments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[PaymentRead]:
        """Página de transacciones de pago del tenant."""

    # ---- Leads ------------------------------------------------------------
    @abstractmethod
    def capture_lead(
        self, *, tenant_id: uuid.UUID, data: LeadRequest
    ) -> LeadRead:
        """Captura un prospecto y lo notifica al CRM (si está configurado)."""

    @abstractmethod
    def get_lead(
        self, *, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> LeadRead:
        """Devuelve un prospecto por su ID."""

    @abstractmethod
    def find_lead_by_phone(
        self, *, tenant_id: uuid.UUID, phone: str
    ) -> LeadRead | None:
        """Devuelve el lead más reciente del tenant con ese teléfono (o ``None``).

        Permite al subsistema del BOT heredar la atribución de campaña de un
        lead capturado en la landing hacia la conversación del mismo contacto.
        """

    @abstractmethod
    def list_leads(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[LeadRead]:
        """Página de prospectos del tenant."""

    @abstractmethod
    def lead_attribution(self, *, tenant_id: uuid.UUID) -> LeadAttributionRead:
        """Reporte de atribución por campaña (UTM) del tenant activo."""

    # ---- Cotizaciones -----------------------------------------------------
    @abstractmethod
    def generate_quote(
        self, *, tenant_id: uuid.UUID, data: QuoteRequest
    ) -> QuoteResponse:
        """Calcula totales y genera el PDF de una cotización."""

    @abstractmethod
    def get_quote(
        self, *, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> QuoteRead:
        """Devuelve una cotización por su ID."""

    @abstractmethod
    def list_quotes(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[QuoteRead]:
        """Página de cotizaciones del tenant."""

    # ---- Citas ------------------------------------------------------------
    @abstractmethod
    def schedule_appointment(
        self, *, tenant_id: uuid.UUID, data: AppointmentRequest
    ) -> AppointmentResponse:
        """Agenda una cita y genera la invitación ICS."""

    @abstractmethod
    def get_appointment(
        self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID
    ) -> AppointmentRead:
        """Devuelve una cita por su ID."""

    @abstractmethod
    def list_appointments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[AppointmentRead]:
        """Página de citas del tenant."""

    # ---- Portal del cliente (C-3) ------------------------------------------
    # Consultas acotadas por ``tenant_id`` + ``customer_email`` (identidad del
    # cliente en el portal privado). Reutilizan la paginación estándar.
    @abstractmethod
    def list_payments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[PaymentRead]:
        """Página de pagos del cliente (identificado por su correo) en el tenant."""

    @abstractmethod
    def list_leads_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[LeadRead]:
        """Página de leads del cliente (identificado por su correo) en el tenant."""

    @abstractmethod
    def list_quotes_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[QuoteRead]:
        """Página de cotizaciones del cliente (identificado por su correo) en el tenant."""

    @abstractmethod
    def list_appointments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[AppointmentRead]:
        """Página de citas del cliente (identificado por su correo) en el tenant."""
