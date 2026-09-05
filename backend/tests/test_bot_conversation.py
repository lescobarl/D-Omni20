"""Pruebas del servicio de conversación del bot (Fase 6).

Verifica que ``ConversationService`` delega cada intención de workflow en los
servicios existentes por DI — un solo dueño por transacción (checkout, leads,
cotizaciones y citas) — y que persiste la conversación, el mensaje de salida y
la auditoría dentro de una única sesión multi-tenant (regla CLAUDE: RLS sigue
aplicando). Sin intención de workflow, la conversación general cae al router de
proveedores IA con el contexto de la empresa.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from app.bot.context_bundle import CompanyContextBundle
from app.bot.conversation_service import ConversationService
from app.bot.interfaces import (
    BotResponse,
    ConversationContext,
    IChannelAdapter,
    InboundMessage,
    IResponseProvider,
    ProviderConfig,
)
from app.bot.models import BotConversation, BotMessage
from app.bot.queue import (
    CONVERSATION_STATE_ACTIVE,
    DIRECTION_OUTBOUND,
    QUEUE_SENT,
)
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
)
from app.core.di import Container
from app.core.errors import NotFoundError
from app.core.logging import ILogger
from app.models.base import utcnow
from app.repositories.sqlalchemy_repositories import SqlAlchemyKeywordRepository
from app.schemas.workflow import (
    AppointmentResponse,
    CheckoutResponse,
    LeadRead,
    QuoteResponse,
)


class FakeLogger(ILogger):
    """Logger en memoria que registra todos los eventos estructurados."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def _record(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, dict(fields)))

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)


class _StubAdapter(IChannelAdapter):
    """Adaptador de canal mínimo (el envío se conecta en Fase 6.1)."""

    @property
    def kind(self) -> str:
        return "stub"

    def parse_inbound(self, *, payload: Any) -> InboundMessage:
        return InboundMessage(channel_id=uuid.uuid4(), external_contact_id="stub", text=str(payload))

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        return True


class _StubBundleService:
    """Resuelve bundles desde un mapa en memoria (duck-typed del puerto)."""

    def __init__(self, bundles: dict[uuid.UUID, CompanyContextBundle] | None = None) -> None:
        self.bundles: dict[uuid.UUID, CompanyContextBundle] = dict(bundles or {})

    def get_bundle(self, *, channel_id: uuid.UUID) -> CompanyContextBundle:
        try:
            return self.bundles[channel_id]
        except KeyError:
            raise NotFoundError(
                "Canal no encontrado o deshabilitado",
                operation="bot.context.resolve",
                context={"channel_id": str(channel_id)},
            ) from None


class _FakeWorkflowService:
    """Falso de :class:`IWorkflowService` (duck-typed, sin los 20 métodos).

    Registra las llamadas y devuelve respuestas canónicas o lanza si ``fail``
    está configurado (para verificar el rollback de la sesión).
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.fail: Exception | None = None

    def _guard(self) -> None:
        if self.fail is not None:
            raise self.fail

    def create_checkout(self, *, tenant_id: uuid.UUID, data: Any) -> CheckoutResponse:
        self.calls.append(("create_checkout", data))
        self._guard()
        return CheckoutResponse(
            payment_id=uuid.uuid4(),
            status="pending",
            checkout_url="https://pay.example/x",
            provider="sandbox",
        )

    def capture_lead(self, *, tenant_id: uuid.UUID, data: Any) -> LeadRead:
        self.calls.append(("capture_lead", data))
        self._guard()
        now = utcnow()
        return LeadRead(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            source=data.source,
            status="new",
            metadata_json={},
            created_at=now,
            revision=1,
            updated_at=now,
        )

    def generate_quote(self, *, tenant_id: uuid.UUID, data: Any) -> QuoteResponse:
        self.calls.append(("generate_quote", data))
        self._guard()
        return QuoteResponse(
            quote_id=uuid.uuid4(),
            status="generated",
            subtotal=Decimal("250.00"),
            tax=Decimal("0.00"),
            total=Decimal("250.00"),
            currency="mxn",
            pdf_url="https://example.com/quotes/q.pdf",
        )

    def schedule_appointment(self, *, tenant_id: uuid.UUID, data: Any) -> AppointmentResponse:
        self.calls.append(("schedule_appointment", data))
        self._guard()
        starts_at = data.starts_at
        return AppointmentResponse(
            appointment_id=uuid.uuid4(),
            status="scheduled",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=data.duration_minutes),
            timezone="UTC",
            ics_url="https://example.com/events/e.ics",
        )


class _FakeAuditService:
    """Falso del puerto de auditoría (duck-typed): registra cada ``record``."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def record(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.records.append(
            {
                "tenant_id": tenant_id,
                "operation": operation,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "details": details,
            }
        )


class _FakeRouter(IResponseProvider):
    """Router falso que registra las llamadas a ``respond`` y su cierre."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, ConversationContext]] = []
        self.closed = False

    @property
    def kind(self) -> str:
        return "stub"

    @property
    def name(self) -> str:
        return "stub-router"

    def respond(self, *, user_message: str, conversation_context: ConversationContext) -> BotResponse:
        self.calls.append((user_message, conversation_context))
        return BotResponse(content="hola", provider_kind="stub", provider_used="stub-router")

    def close(self) -> None:
        self.closed = True


# ── Helpers ----------------------------------------------------------------


def _catalog_item(
    *,
    sku: str,
    name: str,
    description: str = "",
    price: str = "250.00",
    currency: str = "MXN",
    available: bool = True,
) -> dict[str, Any]:
    return {
        "sku": sku,
        "name": name,
        "description": description,
        "price": price,
        "currency": currency,
        "available": available,
        "metadata": {},
    }


def _build_bundle(
    *,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
    channel_type: str = "whatsapp",
    providers: tuple[ProviderConfig, ...] = (),
    catalog_items: tuple[dict[str, Any], ...] = (),
) -> CompanyContextBundle:
    return CompanyContextBundle(
        tenant_id=tenant_id,
        channel_id=channel_id,
        channel_type=channel_type,
        phone_number_id="123456789",
        access_token="",
        webhook_secret="",
        prompt_base="",
        providers=providers,
        content_items=(),
        catalog_items=catalog_items,
    )


def _build_service(
    container: Container,
    logger: ILogger,
    bundle_service: _StubBundleService,
    workflow: _FakeWorkflowService,
    router: _FakeRouter,
    audit: _FakeAuditService,
) -> ConversationService:
    return ConversationService(
        database=container.database,
        context_bundle_service=bundle_service,
        settings=container.settings,
        logger=logger,
        conversation_repository_factory=SqlAlchemyBotConversationRepository,
        message_repository_factory=SqlAlchemyBotMessageRepository,
        keyword_repository_factory=SqlAlchemyKeywordRepository,
        audit_service_factory=lambda _session: audit,
        workflow_service_factory=lambda _session: workflow,
        provider_router_factory=lambda _bundle, **kwargs: router,
    )


def _inbound(channel_id: uuid.UUID, text: str, external_contact_id: str = "wa-123") -> InboundMessage:
    return InboundMessage(channel_id=channel_id, external_contact_id=external_contact_id, text=text)


def _conversations(container: Container, tenant_id: uuid.UUID) -> list[BotConversation]:
    with container.database.session_scope() as session:
        items, _total = SqlAlchemyBotConversationRepository(session).list(
            tenant_id=tenant_id, page=1, page_size=1000
        )
        return items


def _messages(container: Container, tenant_id: uuid.UUID) -> list[BotMessage]:
    with container.database.session_scope() as session:
        items, _total = SqlAlchemyBotMessageRepository(session).list(
            tenant_id=tenant_id, page=1, page_size=1000
        )
        return items


# ── Delegación a workflows (un solo dueño por transacción) -----------------


def test_checkout_intent_delegates_and_persists(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero comprar, pago 150 pesos"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "workflow"
    assert response.provider_used == "checkout"
    assert response.metadata["intent"] == "checkout"
    assert response.content.startswith("Listo, generé tu orden de pago por 150 MXN.")
    assert "Referencia:" in response.content
    assert "Completa tu pago aquí: https://pay.example/x" in response.content

    assert len(workflow.calls) == 1
    name, data = workflow.calls[0]
    assert name == "create_checkout"
    assert data.amount == Decimal("150")
    assert data.currency == "mxn"
    assert data.customer_email is None
    assert data.customer_name == "wa-123"
    assert data.metadata == {"source": "bot", "channel_type": "whatsapp"}

    conversations = _conversations(container, tenant)
    assert len(conversations) == 1
    conversation = conversations[0]
    assert conversation.channel_id == channel_id
    assert conversation.external_contact_id == "wa-123"
    assert conversation.state == CONVERSATION_STATE_ACTIVE

    messages = _messages(container, tenant)
    assert len(messages) == 1
    outbound = messages[0]
    assert outbound.conversation_id == conversation.id
    assert outbound.direction == DIRECTION_OUTBOUND
    assert outbound.queue_status == QUEUE_SENT
    assert outbound.message_id is None
    assert outbound.provider_used == "checkout"

    assert len(audit.records) == 1
    record = audit.records[0]
    assert record["tenant_id"] == tenant
    assert record["operation"] == "bot.conversation.reply"
    assert record["entity_type"] == "bot_message"
    assert record["details"]["intent"] == "checkout"
    assert record["details"]["provider_kind"] == "workflow"
    assert record["details"]["provider_used"] == "checkout"
    assert record["details"]["channel_id"] == str(channel_id)


def test_lead_intent_delegates_and_persists(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Me interesa, mi correo es juan@example.com"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "workflow"
    assert response.provider_used == "lead"
    assert response.metadata["intent"] == "lead"
    assert response.content == ("¡Gracias juan! Hemos registrado tus datos y un asesor te contactará pronto.")

    assert len(workflow.calls) == 1
    name, data = workflow.calls[0]
    assert name == "capture_lead"
    assert data.email == "juan@example.com"
    assert data.name == "juan"
    assert data.phone is None
    assert data.source == "bot"
    assert data.metadata == {"channel_type": "whatsapp", "external_contact_id": "wa-123"}

    messages = _messages(container, tenant)
    assert len(messages) == 1
    assert messages[0].provider_used == "lead"


def test_quote_intent_matches_catalog_and_delegates(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(
        tenant_id=tenant,
        channel_id=channel_id,
        catalog_items=(
            _catalog_item(sku="srv-1", name="Desarrollo Web", description="Sitio web profesional"),
        ),
    )
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero una cotización de Desarrollo Web"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "workflow"
    assert response.provider_used == "quote"
    assert response.metadata["intent"] == "quote"
    assert response.content == (
        "Aquí está tu cotización:\n"
        "- Subtotal: 250.00 MXN\n"
        "- Impuestos: 0.00 MXN\n"
        "- Total: 250.00 MXN\n"
        "Descarga el PDF: https://example.com/quotes/q.pdf"
    )

    assert len(workflow.calls) == 1
    name, data = workflow.calls[0]
    assert name == "generate_quote"
    assert data.currency == "mxn"
    assert len(data.services) == 1
    assert data.services[0].name == "Desarrollo Web"
    assert data.services[0].description == "Sitio web profesional"
    assert data.services[0].unit_price == Decimal("250.00")

    messages = _messages(container, tenant)
    assert len(messages) == 1
    assert messages[0].provider_used == "quote"


def test_appointment_intent_delegates_and_persists(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(
        tenant_id=tenant,
        channel_id=channel_id,
        catalog_items=(_catalog_item(sku="srv-2", name="Consulta Médica", description="Consulta general"),),
    )
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero agendar una cita de Consulta Médica para 2026-09-01 10:30"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "workflow"
    assert response.provider_used == "appointment"
    assert response.metadata["intent"] == "appointment"
    assert response.content == (
        "¡Listo! Tu cita para Consulta Médica quedó agendada para el "
        "2026-09-01T10:30:00+00:00.\n"
        "Descarga tu invitación: https://example.com/events/e.ics"
    )

    assert len(workflow.calls) == 1
    name, data = workflow.calls[0]
    assert name == "schedule_appointment"
    assert data.service == "Consulta Médica"
    assert data.starts_at == datetime(2026, 9, 1, 10, 30, tzinfo=UTC)
    assert data.duration_minutes == 30
    assert data.notes == "Quiero agendar una cita de Consulta Médica para 2026-09-01 10:30"

    messages = _messages(container, tenant)
    assert len(messages) == 1
    assert messages[0].provider_used == "appointment"


# ── Aclaraciones (dato faltante) -------------------------------------------


def test_lead_without_email_returns_clarify(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Me interesa"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "conversation"
    assert response.provider_used == "clarify"
    assert response.metadata == {"intent": "lead", "clarify": True}
    assert response.content == (
        "Con gusto te contactamos. Para registrarte necesito tu correo electrónico, por favor."
    )
    assert workflow.calls == []

    messages = _messages(container, tenant)
    assert len(messages) == 1
    assert messages[0].provider_used == "clarify"


def test_checkout_without_amount_returns_clarify(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero comprar"),
        adapter=_StubAdapter(),
    )

    assert response.provider_used == "clarify"
    assert response.metadata == {"intent": "checkout", "clarify": True}
    assert response.content == (
        "Claro, con gusto. Para generar tu orden de pago, ¿me indicas el monto a pagar?"
    )
    assert workflow.calls == []


def test_quote_without_catalog_match_returns_clarify(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(
        tenant_id=tenant,
        channel_id=channel_id,
        catalog_items=(_catalog_item(sku="srv-1", name="Desarrollo Web"),),
    )
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero una cotización"),
        adapter=_StubAdapter(),
    )

    assert response.provider_used == "clarify"
    assert response.metadata == {"intent": "quote", "clarify": True}
    assert response.content == (
        "Claro. ¿Sobre cuál de estos servicios quieres tu cotización?\n- Desarrollo Web"
    )
    assert workflow.calls == []


def test_quote_without_catalog_returns_clarify(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero una cotización"),
        adapter=_StubAdapter(),
    )

    assert response.provider_used == "clarify"
    assert response.content == "Claro. Cuéntame sobre el servicio que te gustaría cotizar."
    assert workflow.calls == []


def test_appointment_missing_service_or_time_returns_clarify(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(
        tenant_id=tenant,
        channel_id=channel_id,
        catalog_items=(_catalog_item(sku="srv-2", name="Consulta Médica"),),
    )
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Quiero agendar una cita"),
        adapter=_StubAdapter(),
    )

    assert response.provider_used == "clarify"
    assert response.metadata == {"intent": "appointment", "clarify": True}
    assert response.content == (
        "Perfecto. ¿Para qué servicio y a qué día/hora te gustaría agendar? "
        "(formato AAAA-MM-DD HH:MM)\n- Consulta Médica"
    )
    assert workflow.calls == []


# ── Conversación general (router de proveedores IA) ------------------------


def test_general_chat_falls_back_to_router(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    response = service.handle_inbound(
        message=_inbound(channel_id, "Hola, ¿cómo estás?"),
        adapter=_StubAdapter(),
    )

    assert response.provider_kind == "stub"
    assert response.provider_used == "stub-router"
    assert response.content == "hola"

    assert len(router.calls) == 1
    user_message, context = router.calls[0]
    assert user_message == "Hola, ¿cómo estás?"
    assert context.tenant_id == tenant
    assert context.channel_id == channel_id
    assert context.external_contact_id == "wa-123"
    assert context.provider.provider_kind == "local"
    assert context.history == ()
    assert router.closed is True
    assert workflow.calls == []

    messages = _messages(container, tenant)
    assert len(messages) == 1
    assert messages[0].provider_used == "stub-router"


def test_general_chat_reuses_conversation_and_loads_history(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(tenant_id=tenant, channel_id=channel_id)
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    service.handle_inbound(message=_inbound(channel_id, "Hola"), adapter=_StubAdapter())
    assert len(router.calls) == 1
    assert router.calls[0][1].history == ()

    service.handle_inbound(
        message=_inbound(channel_id, "¿Qué servicios ofrecen?"),
        adapter=_StubAdapter(),
    )
    assert len(router.calls) == 2
    assert router.calls[1][1].history == ({"role": "assistant", "content": "hola"},)

    conversations = _conversations(container, tenant)
    assert len(conversations) == 1
    conversation_id = conversations[0].id

    messages = _messages(container, tenant)
    assert len(messages) == 2
    assert all(message.conversation_id == conversation_id for message in messages)
    assert all(message.direction == DIRECTION_OUTBOUND for message in messages)


# ── Robustez (errores con contexto y rollback de la sesión) ----------------


def test_unknown_channel_raises_not_found(container: Container) -> None:
    workflow = _FakeWorkflowService()
    audit = _FakeAuditService()
    service = ConversationService(
        database=container.database,
        context_bundle_service=container.context_bundle_service,
        settings=container.settings,
        logger=FakeLogger(),
        conversation_repository_factory=SqlAlchemyBotConversationRepository,
        message_repository_factory=SqlAlchemyBotMessageRepository,
        keyword_repository_factory=SqlAlchemyKeywordRepository,
        audit_service_factory=lambda _session: audit,
        workflow_service_factory=lambda _session: workflow,
        provider_router_factory=lambda _bundle, **kwargs: _FakeRouter(),
    )

    with pytest.raises(NotFoundError):
        service.handle_inbound(
            message=_inbound(uuid.uuid4(), "Hola"),
            adapter=_StubAdapter(),
        )
    assert workflow.calls == []
    assert audit.records == []


def test_workflow_exception_propagates_and_rolls_back(container: Container) -> None:
    tenant = uuid.uuid4()
    channel_id = uuid.uuid4()
    bundle = _build_bundle(
        tenant_id=tenant,
        channel_id=channel_id,
        catalog_items=(_catalog_item(sku="srv-1", name="Desarrollo Web"),),
    )
    bundle_service = _StubBundleService({channel_id: bundle})
    workflow = _FakeWorkflowService()
    workflow.fail = RuntimeError("boom")
    router = _FakeRouter()
    audit = _FakeAuditService()
    service = _build_service(container, FakeLogger(), bundle_service, workflow, router, audit)

    with pytest.raises(RuntimeError, match="boom"):
        service.handle_inbound(
            message=_inbound(channel_id, "Quiero una cotización de Desarrollo Web"),
            adapter=_StubAdapter(),
        )

    assert len(workflow.calls) == 1
    assert _conversations(container, tenant) == []
    assert _messages(container, tenant) == []
    assert audit.records == []


# ── Motor de prueba del router (Fase 4) -------------------------------------


def _seed_keyword(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    term: str,
    response: str = "Respuesta fija",
    priority: int = 100,
) -> None:
    """Siembra una keyword confirmada (commit) para un tenant aislado."""
    with container.database.session_scope() as session:
        SqlAlchemyKeywordRepository(session).create(
            tenant_id=tenant_id,
            term=term,
            response=response,
            priority=priority,
            enabled=True,
            version=1,
        )


def _build_router_service(container: Container) -> ConversationService:
    """Construye el servicio mínimo para ``route_for_test`` (sin workflows reales)."""
    return ConversationService(
        database=container.database,
        context_bundle_service=container.context_bundle_service,
        settings=container.settings,
        logger=FakeLogger(),
        conversation_repository_factory=SqlAlchemyBotConversationRepository,
        message_repository_factory=SqlAlchemyBotMessageRepository,
        keyword_repository_factory=SqlAlchemyKeywordRepository,
        audit_service_factory=lambda _session: _FakeAuditService(),
        workflow_service_factory=lambda _session: _FakeWorkflowService(),
    )


def test_route_for_test_keyword_branch_wins(container: Container) -> None:
    tenant = uuid.uuid4()
    _seed_keyword(container, tenant, term="Garantía", response="Te explico la garantía", priority=10)

    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="quiero saber sobre garantia"
    )

    assert trace.matched_route == "keyword"
    assert trace.branch == "keyword"
    assert trace.keyword == "Garantía"
    assert trace.keyword_priority == 10
    assert trace.intent is None
    assert trace.response == "Te explico la garantía"
    assert trace.confidence == 1.0
    assert len(trace.steps) == 1
    assert trace.steps[0].branch == "keyword"
    assert trace.steps[0].outcome == "match"


def test_route_for_test_keyword_is_tenant_scoped(container: Container) -> None:
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    _seed_keyword(container, tenant_a, term="Garantía", response="Solo A")

    # El tenant B no debe ver la keyword del tenant A.
    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant_b, message="quiero saber sobre garantia"
    )

    assert trace.matched_route == "general_chat"
    assert trace.keyword is None


def test_route_for_test_intent_checkout_with_amount(container: Container) -> None:
    tenant = uuid.uuid4()

    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="quiero comprar 150 pesos"
    )

    assert trace.matched_route == "intent"
    assert trace.branch == "intent:checkout"
    assert trace.intent == "checkout"
    assert trace.keyword is None
    assert trace.confidence == 1.0
    assert "monto presente: 150" in (trace.response or "")
    assert len(trace.steps) == 2
    assert trace.steps[1].branch == "intent:checkout"
    assert trace.steps[1].outcome == "match"


def test_route_for_test_intent_confidence_is_fractional(container: Container) -> None:
    tenant = uuid.uuid4()

    # "me interesa" (lead) + "pagar" (checkout): checkout gana por prioridad,
    # pero la confianza es la fracción del score sobre el total (1/2). Se usa
    # "pagar" (no "comprar") para evitar que "compra" cuente como subcadena de
    # "comprar" y sesgue el puntaje.
    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="me interesa pagar"
    )

    assert trace.matched_route == "intent"
    assert trace.intent == "checkout"
    assert trace.confidence == 0.5
    assert "monto" in (trace.response or "")


def test_route_for_test_intent_lead_readiness(container: Container) -> None:
    tenant = uuid.uuid4()

    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="me interesa su servicio"
    )

    assert trace.matched_route == "intent"
    assert trace.intent == "lead"
    assert trace.confidence == 1.0
    assert "correo" in (trace.response or "")


def test_route_for_test_intent_appointment_with_datetime(container: Container) -> None:
    tenant = uuid.uuid4()

    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="agendar cita para 2026-09-01 10:30"
    )

    assert trace.matched_route == "intent"
    assert trace.intent == "appointment"
    assert "2026-09-01 10:30" in (trace.response or "")


def test_route_for_test_general_chat_fallthrough(container: Container) -> None:
    tenant = uuid.uuid4()

    trace = _build_router_service(container).route_for_test(
        tenant_id=tenant, message="asdfqwerty sin intencion ni keyword"
    )

    assert trace.matched_route == "general_chat"
    assert trace.branch == "general_chat"
    assert trace.keyword is None
    assert trace.intent is None
    assert trace.response is None
    assert trace.confidence == 0.0
    assert len(trace.steps) == 3
    assert trace.steps[0].outcome == "no_match"
    assert trace.steps[1].outcome == "no_match"
    assert trace.steps[2].outcome == "fallthrough"


def test_route_for_test_does_not_persist_or_queue(container: Container) -> None:
    tenant = uuid.uuid4()
    _seed_keyword(container, tenant, term="Hola", response="¡Hola!")

    service = _build_router_service(container)
    service.route_for_test(tenant_id=tenant, message="Hola")
    service.route_for_test(tenant_id=tenant, message="quiero comprar 150 pesos")
    service.route_for_test(tenant_id=tenant, message="asdfqwerty")

    # DoD Fase 4: probar el router no contamina datos (sin conversaciones ni mensajes).
    assert _conversations(container, tenant) == []
    assert _messages(container, tenant) == []
