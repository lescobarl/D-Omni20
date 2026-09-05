"""Pruebas del dispatcher de campañas de recompra / postventa / recuperación (C-2).

Cubre el disparo programado (``dispatch_due``), el disparo por evento
(``dispatch_event``), la segmentación por tags, la idempotencia por
destinatario, el manejo de fallos del proveedor y la vida del hilo de
polling. Sigue las convenciones de ``test_scheduler.py`` (fakes + in-memory
SQLite + logger de grabación).
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Generator

import pytest
from sqlalchemy import select

from app.core.database import Database
from app.core.errors import InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.audit_log import AuditLog
from app.models.base import Base
from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotContact,
    BotTemplate,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyCampaignRecipientRepository,
    SqlAlchemyCampaignRepository,
    SqlAlchemyContactRepository,
    SqlAlchemyRecipientFileRepository,
    SqlAlchemyTemplateRepository,
    SqlAlchemyTenantRepository,
)
from app.services.audit_service import AuditService
from app.services.campaign_service import (
    CAMPAIGN_STATE_ACTIVE,
    CAMPAIGN_STATE_COMPLETED,
    CampaignDispatcher,
    OPERATION_CAMPAIGN_DISPATCH,
    OPERATION_CAMPAIGN_RECIPIENT_FAILED,
    RECIPIENT_STATE_FAILED,
    RECIPIENT_STATE_SENT,
    RECIPIENT_STATE_SKIPPED,
    SEGMENT_TYPE_EVENT,
    SEGMENT_TYPE_TAGS,
    _naive_utc,
)
from app.services.workflow_interfaces import IWhatsAppSender, IWhatsAppSenderFactory

TENANT_HEADERS = {"X-Tenant-Id": "dev-tenant"}
EMAIL = "ana@example.com"
PHONE = "+52 1"


def _now() -> datetime:
    return _naive_utc(datetime.now(timezone.utc))


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc)


class _RecordingLogger(ILogger):
    """Logger de prueba que acumula (evento, campos) en memoria."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def events_named(self, name: str) -> list[dict[str, Any]]:
        return [fields for (event, fields) in self.events if event == name]

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))


class _FakeWhatsAppSender(IWhatsAppSender):
    """Sender de WhatsApp de prueba que graba cada llamada."""

    def __init__(self, *, ok: bool = True, raise_error: Exception | None = None) -> None:
        self.ok = ok
        self.raise_error = raise_error
        self.calls: list[dict[str, Any]] = []

    def send_template_message(
        self,
        *,
        to_phone: str,
        template_name: str,
        template_variables: dict[str, str],
    ) -> bool:
        if self.raise_error is not None:
            raise self.raise_error
        self.calls.append(
            {
                "kind": "template",
                "to_phone": to_phone,
                "template_name": template_name,
                "template_variables": template_variables,
            }
        )
        return self.ok

    def send_text(self, *, to_phone: str, text: str) -> bool:
        if self.raise_error is not None:
            raise self.raise_error
        self.calls.append({"kind": "text", "to_phone": to_phone, "text": text})
        return self.ok

    def verify_webhook_signature(self, *, payload: bytes, signature: str | None) -> bool:
        return True

    def close(self) -> None:
        return None


class _FakeSenderFactory(IWhatsAppSenderFactory):
    """Fábrica que devuelve un sender fijo o ``None`` (canal deshabilitado)."""

    def __init__(self, sender: IWhatsAppSender | None = None) -> None:
        self.sender = sender
        self.senders: dict[uuid.UUID, IWhatsAppSender] = {}

    def resolve_sender_for_tenant(self, *, tenant_id: uuid.UUID) -> IWhatsAppSender | None:
        return self.senders.get(tenant_id, self.sender)


class _BoomAuditService:
    """Auditoría de prueba que revienta en ``record`` (para ``_audit`` fail-soft)."""

    def record(self, **kwargs: Any) -> None:
        raise RuntimeError("auditoría caída")


def _create_contact(
    env: dict[str, Any],
    *,
    phone: str,
    name: str | None = None,
    email: str | None = None,
    tags: list[str] | None = None,
    state: str = "active",
    tenant_id: uuid.UUID | None = None,
) -> BotContact:
    with env["database"].session_scope() as session:
        contact_repo = SqlAlchemyContactRepository(session)
        contact = contact_repo.create(
            tenant_id=tenant_id or env["tenant_id"],
            phone=phone,
            name=name,
            email=email,
            tags=tags or [],
            state=state,
            source="manual",
            external_contact_id=None,
            last_contact_at=None,
        )
        return contact


def _create_template(
    env: dict[str, Any],
    *,
    name: str,
    body: str = "Hola {{ name }}!",
    template_type: str = "text",
    variables: list[str] | None = None,
    tenant_id: uuid.UUID | None = None,
) -> BotTemplate:
    with env["database"].session_scope() as session:
        template_repo = SqlAlchemyTemplateRepository(session)
        template = template_repo.create(
            tenant_id=tenant_id or env["tenant_id"],
            name=name,
            body=body,
            template_type=template_type,
            variables=variables or [],
        )
        return template


def _create_campaign(
    env: dict[str, Any],
    *,
    name: str,
    template_id: uuid.UUID | None = None,
    state: str = CAMPAIGN_STATE_ACTIVE,
    schedule: datetime | None = None,
    segment_type: str | None = None,
    segment_config: dict[str, Any] | None = None,
    trigger_type: str | None = None,
    trigger_event: str | None = None,
    tenant_id: uuid.UUID | None = None,
) -> BotCampaign:
    with env["database"].session_scope() as session:
        campaign_repo = SqlAlchemyCampaignRepository(session)
        campaign = campaign_repo.create(
            tenant_id=tenant_id or env["tenant_id"],
            name=name,
            template_id=template_id,
            state=state,
            schedule=schedule,
            segment_type=segment_type,
            segment_config=segment_config,
            trigger_type=trigger_type,
            trigger_event=trigger_event,
        )
        return campaign


def _get_campaign(env: dict[str, Any], campaign_id: uuid.UUID) -> BotCampaign | None:
    with env["database"].session_scope() as session:
        campaign_repo = SqlAlchemyCampaignRepository(session)
        return campaign_repo.get(tenant_id=env["tenant_id"], campaign_id=campaign_id)


def _list_recipients(env: dict[str, Any], campaign_id: uuid.UUID) -> list[BotCampaignRecipient]:
    with env["database"].session_scope() as session:
        rows = session.execute(
            select(BotCampaignRecipient)
            .where(BotCampaignRecipient.campaign_id == campaign_id)
            .order_by(BotCampaignRecipient.contact_id)
        ).scalars().all()
        return list(rows)


@pytest.fixture
def campaign_dispatcher_env() -> Generator[dict[str, Any], None, None]:
    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    with database.session_scope() as session:
        tenant = SqlAlchemyTenantRepository(session).create(
            slug="dev-tenant", name="Tenant de Desarrollo"
        )
        tenant_id = tenant.id
    logger = _RecordingLogger()
    whatsapp_sender = _FakeWhatsAppSender()
    sender_factory = _FakeSenderFactory(sender=whatsapp_sender)
    dispatcher = CampaignDispatcher(
        database=database,
        campaign_repository_factory=lambda s: SqlAlchemyCampaignRepository(s),
        contact_repository_factory=lambda s: SqlAlchemyContactRepository(s),
        recipient_repository_factory=lambda s: SqlAlchemyCampaignRecipientRepository(s),
        recipient_file_repository_factory=lambda s: SqlAlchemyRecipientFileRepository(s),
        audit_factory=lambda s: AuditService(
            repository=SqlAlchemyAuditRepository(s), logger=logger
        ),
        sender_factory=sender_factory,
        logger=logger,
        poll_interval_seconds=0.02,
    )
    env: dict[str, Any] = {
        "database": database,
        "dispatcher": dispatcher,
        "logger": logger,
        "whatsapp_sender": whatsapp_sender,
        "sender_factory": sender_factory,
        "tenant_id": tenant_id,
    }
    yield env
    dispatcher.stop()
    database.dispose()


def test_dispatch_due_sends_to_all_contacts_and_completes_campaign(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone="+52 1", name="Ana", email=EMAIL)
    _create_contact(env, phone="+52 2", name="Luis")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Recompra Semanal",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 2
    assert totals.recipients_failed == 0
    assert totals.recipients_skipped == 0
    calls = env["whatsapp_sender"].calls
    assert len(calls) == 2
    assert {c["to_phone"] for c in calls} == {"+52 1", "+52 2"}
    assert all(c["kind"] == "text" for c in calls)

    stored = _get_campaign(env, campaign.id)
    assert stored is not None
    assert stored.state == CAMPAIGN_STATE_COMPLETED
    assert stored.last_triggered_at is not None

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 2
    assert all(r.state == RECIPIENT_STATE_SENT for r in recipients)
    assert all(r.result == "enviado" for r in recipients)
    assert all(r.attempts == 1 for r in recipients)

    due = env["logger"].events_named("campaign.due.completed")
    assert due and due[0]["sent"] == 2


def test_dispatch_due_ignores_future_and_draft_campaigns(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    _create_campaign(
        env,
        name="Futura",
        template_id=template.id,
        schedule=_now() + timedelta(hours=1),
    )
    _create_campaign(
        env,
        name="Borrador",
        template_id=template.id,
        state="draft",
        schedule=_now() - timedelta(hours=1),
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 0
    assert totals.recipients_sent == 0
    assert env["whatsapp_sender"].calls == []


def test_dispatch_due_segments_by_tags_any(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone="+52 1", name="Ana", tags=["vip"])
    _create_contact(env, phone="+52 2", name="Luis", tags=["nuevo"])
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="VIP",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
        segment_type=SEGMENT_TYPE_TAGS,
        segment_config={"tags": ["vip"], "match": "any"},
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert [c["to_phone"] for c in calls] == ["+52 1"]
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1


def test_dispatch_due_segments_by_tags_all(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone="+52 1", name="Ana", tags=["vip", "leal"])
    _create_contact(env, phone="+52 2", name="Luis", tags=["vip"])
    _create_contact(env, phone="+52 3", name="Eva", tags=[])
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Leales",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
        segment_type=SEGMENT_TYPE_TAGS,
        segment_config={"tags": ["vip", "leal"], "match": "all"},
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert [c["to_phone"] for c in calls] == ["+52 1"]
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1


def test_dispatch_due_event_campaign_without_trigger_sends_nothing(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    # Campaña de evento sin disparo por evento: entra en el ciclo agendado
    # (trigger_type None) pero su audiencia es vacía (no hay contacto disparador).
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Evento Sin Disparo",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
        segment_type=SEGMENT_TYPE_EVENT,
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 0
    assert totals.recipients_failed == 0
    assert totals.recipients_skipped == 0
    assert env["whatsapp_sender"].calls == []
    recipients = _list_recipients(env, campaign.id)
    assert recipients == []
    stored = _get_campaign(env, campaign.id)
    assert stored is not None
    assert stored.state == CAMPAIGN_STATE_COMPLETED


def test_dispatch_event_is_idempotent_for_sent_recipients(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    contact = _create_contact(env, phone=PHONE, name="Ana", email=EMAIL)
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Recompra Evento",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="checkout.created",
    )

    first = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=contact.id,
    )
    second = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=contact.id,
    )

    assert first.campaigns_processed == 1
    assert first.recipients_sent == 1
    assert second.campaigns_processed == 1
    assert second.recipients_sent == 0
    assert second.recipients_skipped == 1
    assert len(env["whatsapp_sender"].calls) == 1

    stored = _get_campaign(env, campaign.id)
    assert stored is not None
    assert stored.state == CAMPAIGN_STATE_ACTIVE
    assert stored.last_triggered_at is not None

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_SENT
    assert recipients[0].attempts == 1


def test_dispatch_event_retries_failed_recipient_updates_attempts(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    # Un intento fallido deja el destinatario en FAILED; un segundo disparo
    # reenvía y actualiza la fila existente (incrementa intentos).
    env = campaign_dispatcher_env
    contact = _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Recompra Reintento",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="checkout.created",
    )

    env["whatsapp_sender"].ok = False
    first = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=contact.id,
    )
    assert first.recipients_sent == 0
    assert first.recipients_failed == 1

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_FAILED
    assert recipients[0].attempts == 1

    env["whatsapp_sender"].ok = True
    second = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=contact.id,
    )
    assert second.recipients_sent == 1
    assert second.recipients_failed == 0

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_SENT
    assert recipients[0].attempts == 2
    assert len(env["whatsapp_sender"].calls) == 2


def test_dispatch_due_without_sender_marks_skipped(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Sin Canal",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )
    env["sender_factory"].sender = None

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 0
    assert totals.recipients_skipped == 1
    assert env["whatsapp_sender"].calls == []
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_SKIPPED
    assert recipients[0].result == "sin canal WhatsApp habilitado"
    assert recipients[0].attempts == 1


def test_dispatch_due_without_template_marks_skipped(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    campaign = _create_campaign(
        env,
        name="Sin Plantilla",
        template_id=None,
        schedule=_now() - timedelta(hours=1),
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 0
    assert totals.recipients_skipped == 1
    assert env["whatsapp_sender"].calls == []
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_SKIPPED
    assert recipients[0].result == "sin plantilla de mensaje"
    assert recipients[0].attempts == 1


def test_dispatch_due_records_campaign_audit(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Auditada",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )

    env["dispatcher"].dispatch_due()

    with env["database"].session_scope() as session:
        rows = session.execute(
            select(AuditLog).where(AuditLog.operation == OPERATION_CAMPAIGN_DISPATCH)
        ).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.tenant_id == env["tenant_id"]
    assert row.entity_type == "campaign"
    assert row.entity_id == str(campaign.id)
    assert row.details["campaign"] == "Auditada"
    assert row.details["audience"] == 1
    assert row.details["sent"] == 1


def test_dispatch_event_unsupported_event_raises(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    contact = _create_contact(env, phone=PHONE, name="Ana")

    with pytest.raises(InputValidationError) as excinfo:
        env["dispatcher"].dispatch_event(
            tenant_id=env["tenant_id"],
            event_type="unknown.event",
            contact_id=contact.id,
        )

    exc = excinfo.value
    assert exc.operation == OPERATION_CAMPAIGN_DISPATCH
    assert "unknown.event" in str(exc)
    assert exc.context["supported"] == ["checkout.created", "payment.completed"]


def test_dispatch_event_missing_contact_raises_not_found(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    missing_id = uuid.uuid4()

    with pytest.raises(NotFoundError) as excinfo:
        env["dispatcher"].dispatch_event(
            tenant_id=env["tenant_id"],
            event_type="checkout.created",
            contact_id=missing_id,
        )

    exc = excinfo.value
    assert exc.operation == OPERATION_CAMPAIGN_DISPATCH
    assert str(missing_id) in str(exc)


def test_dispatch_event_sends_only_to_trigger_contact(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    ana = _create_contact(env, phone=PHONE, name="Ana", email=EMAIL)
    _create_contact(env, phone="+52 2", name="Luis")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Evento",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="checkout.created",
    )

    totals = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=ana.id,
    )

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert [c["to_phone"] for c in calls] == [PHONE]

    stored = _get_campaign(env, campaign.id)
    assert stored is not None
    assert stored.state == CAMPAIGN_STATE_ACTIVE
    assert stored.last_triggered_at is not None

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].contact_id == ana.id

    event = env["logger"].events_named("campaign.event.completed")
    assert event and event[0]["event_type"] == "checkout.created"
    assert event[0]["sent"] == 1


def test_dispatch_event_filters_campaigns_by_tenant(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    template = _create_template(env, name="Recompra")
    _create_campaign(
        env,
        name="De Dev Tenant",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="checkout.created",
    )
    with env["database"].session_scope() as session:
        other_tenant = SqlAlchemyTenantRepository(session).create(
            slug="other-tenant", name="Otro Tenant"
        )
        other_tenant_id = other_tenant.id
    other_contact = _create_contact(
        env, phone="+52 9", name="Otra", tenant_id=other_tenant_id
    )

    totals = env["dispatcher"].dispatch_event(
        tenant_id=other_tenant_id,
        event_type="checkout.created",
        contact_id=other_contact.id,
    )

    assert totals.campaigns_processed == 0
    assert totals.recipients_sent == 0
    assert env["whatsapp_sender"].calls == []


def test_dispatch_event_respects_tags_segmentation(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    luis = _create_contact(env, phone="+52 2", name="Luis")
    ana = _create_contact(env, phone=PHONE, name="Ana", tags=["vip"])
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="VIP Evento",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_TAGS,
        segment_config={"tags": ["vip"], "match": "any"},
        trigger_type="event",
        trigger_event="checkout.created",
    )

    totals = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=luis.id,
    )

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert [c["to_phone"] for c in calls] == [PHONE]
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].contact_id == ana.id


def test_dispatch_event_renders_context_variables(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    ana = _create_contact(env, phone=PHONE, name="Ana", email=EMAIL)
    template = _create_template(
        env,
        name="Recompra",
        body="Hola {{ name }}! Tu pedido {{ order_id }} esta en camino.",
    )
    campaign = _create_campaign(
        env,
        name="Contexto",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="payment.completed",
    )

    totals = env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="payment.completed",
        contact_id=ana.id,
        context={"order_id": 123, "extra": None},
    )

    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert len(calls) == 1
    text = calls[0]["text"]
    assert "Ana" in text
    assert "123" in text
    assert campaign.id is not None


def test_dispatch_event_records_campaign_audit(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    ana = _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Evento Auditado",
        template_id=template.id,
        segment_type=SEGMENT_TYPE_EVENT,
        trigger_type="event",
        trigger_event="checkout.created",
    )

    env["dispatcher"].dispatch_event(
        tenant_id=env["tenant_id"],
        event_type="checkout.created",
        contact_id=ana.id,
    )

    with env["database"].session_scope() as session:
        rows = session.execute(
            select(AuditLog).where(AuditLog.operation == OPERATION_CAMPAIGN_DISPATCH)
        ).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.tenant_id == env["tenant_id"]
    assert row.entity_type == "campaign"
    assert row.entity_id == str(campaign.id)
    assert row.details["event_type"] == "checkout.created"
    assert row.details["audience"] == 1
    assert row.details["sent"] == 1


def test_audit_failure_is_logged_not_raised(campaign_dispatcher_env: dict[str, Any]) -> None:
    # Un fallo del servicio de auditoría no debe romper el ciclo: se registra
    # en el log como ``campaign.audit.failed`` y el envío continúa.
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    _create_campaign(
        env,
        name="Auditoría Caída",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )
    boom_dispatcher = CampaignDispatcher(
        database=env["database"],
        campaign_repository_factory=lambda s: SqlAlchemyCampaignRepository(s),
        contact_repository_factory=lambda s: SqlAlchemyContactRepository(s),
        recipient_repository_factory=lambda s: SqlAlchemyCampaignRecipientRepository(s),
        recipient_file_repository_factory=lambda s: SqlAlchemyRecipientFileRepository(s),
        audit_factory=lambda _session: _BoomAuditService(),
        sender_factory=env["sender_factory"],
        logger=env["logger"],
        poll_interval_seconds=0.02,
    )

    totals = boom_dispatcher.dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 1
    assert len(env["whatsapp_sender"].calls) == 1
    audit_failures = env["logger"].events_named("campaign.audit.failed")
    assert len(audit_failures) >= 1
    assert audit_failures[0]["error"] == "auditoría caída"


def test_template_type_template_uses_send_template_message(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    ana = _create_contact(env, phone=PHONE, name="Ana", email=EMAIL)
    template = _create_template(
        env,
        name="Recompra",
        body="Plantilla de catálogo",
        template_type="template",
        variables=["name"],
    )
    campaign = _create_campaign(
        env,
        name="Template",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )

    totals = env["dispatcher"].dispatch_due()

    assert totals.recipients_sent == 1
    calls = env["whatsapp_sender"].calls
    assert len(calls) == 1
    call = calls[0]
    assert call["kind"] == "template"
    assert call["to_phone"] == PHONE
    assert call["template_name"] == "Recompra"
    assert call["template_variables"] == {
        "phone": PHONE,
        "name": "Ana",
        "email": EMAIL,
    }
    assert campaign.id is not None


def test_sender_rejection_marks_failed(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Rechazo",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )
    env["whatsapp_sender"].ok = False

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 0
    assert totals.recipients_failed == 1
    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_FAILED
    assert recipients[0].result == "proveedor rechazó el envío"
    assert recipients[0].attempts == 1


def test_sender_exception_marks_failed_logs_and_audits(
    campaign_dispatcher_env: dict[str, Any],
) -> None:
    env = campaign_dispatcher_env
    ana = _create_contact(env, phone=PHONE, name="Ana")
    template = _create_template(env, name="Recompra")
    campaign = _create_campaign(
        env,
        name="Error",
        template_id=template.id,
        schedule=_now() - timedelta(hours=1),
    )
    env["whatsapp_sender"].raise_error = RuntimeError("waba exploded")

    totals = env["dispatcher"].dispatch_due()

    assert totals.campaigns_processed == 1
    assert totals.recipients_sent == 0
    assert totals.recipients_failed == 1

    recipients = _list_recipients(env, campaign.id)
    assert len(recipients) == 1
    assert recipients[0].state == RECIPIENT_STATE_FAILED
    assert recipients[0].result == "error de envío: RuntimeError: waba exploded"
    assert recipients[0].attempts == 1

    errors = env["logger"].events_named("campaign.recipient.error")
    assert len(errors) == 1
    assert errors[0]["contact_id"] == str(ana.id)
    assert errors[0]["campaign_id"] == str(campaign.id)
    assert "waba exploded" in errors[0]["error"]

    with env["database"].session_scope() as session:
        rows = session.execute(
            select(AuditLog).where(
                AuditLog.operation == OPERATION_CAMPAIGN_RECIPIENT_FAILED
            )
        ).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.tenant_id == env["tenant_id"]
    assert row.entity_type == "campaign_recipient"
    assert row.details["campaign_id"] == str(campaign.id)
    assert row.details["contact_id"] == str(ana.id)
    assert row.details["result"] == "error de envío: RuntimeError: waba exploded"


def test_render_body_substitutes_known_and_unknown_variables() -> None:
    rendered = CampaignDispatcher._render_body(
        "Hola {{ name }}! Pedido {{ order_id }} x {{ nada }}",
        {"name": "Ana", "order_id": "123"},
    )
    assert rendered == "Hola Ana! Pedido 123 x "


def test_campaign_dispatcher_thread_lifecycle(campaign_dispatcher_env: dict[str, Any]) -> None:
    env = campaign_dispatcher_env
    dispatcher = env["dispatcher"]
    assert dispatcher.is_running is False

    dispatcher.start()
    assert dispatcher.is_running is True
    dispatcher.start()
    assert dispatcher.is_running is True

    dispatcher.stop()
    assert dispatcher.is_running is False
    dispatcher.stop()

    events = [event for (event, _fields) in env["logger"].events]
    assert "campaign.dispatcher.started" in events
    assert "campaign.dispatcher.stopped" in events


def test_campaign_dispatcher_loop_logs_tick_errors() -> None:
    logger = _RecordingLogger()

    def boom_factory(_session: Any) -> Any:
        raise RuntimeError("base de datos caída")

    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    dispatcher = CampaignDispatcher(
        database=database,
        campaign_repository_factory=boom_factory,
        contact_repository_factory=boom_factory,
        recipient_repository_factory=boom_factory,
        recipient_file_repository_factory=boom_factory,
        audit_factory=boom_factory,
        sender_factory=_FakeSenderFactory(sender=None),
        logger=logger,
        poll_interval_seconds=0.02,
    )
    try:
        dispatcher.start()
        deadline = time.monotonic() + 2.0
        while (
            time.monotonic() < deadline
            and not logger.events_named("campaign.dispatcher.tick.error")
        ):
            time.sleep(0.05)
        errors = logger.events_named("campaign.dispatcher.tick.error")
        assert len(errors) >= 1
        assert "base de datos caída" in errors[0]["error"]
    finally:
        dispatcher.stop()
    assert dispatcher.is_running is False
    database.dispose()
