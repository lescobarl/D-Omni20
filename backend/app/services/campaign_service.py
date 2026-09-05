"""Dispatcher de campañas de recompra / postventa / recuperación (C-2).

Implementación con la stdlib (``threading`` + ``time``) siguiendo la misma
filosofía del scheduler de recordatorios: un hilo daemon hace *polling* de la
base de datos cada ``campaign_poll_interval_seconds``.

Dos modos de disparo (C-2, eslabones ⑦⑧⑨):
1. **Agendado**: campañas ``state == "active"`` con ``schedule <= now`` y
   ``trigger_type`` distinto de ``"event"`` (one-shot). Tras procesar se marca
   ``state = "completed"`` y se fija ``last_triggered_at``.
2. **Por evento**: campañas ``trigger_type == "event"`` cuyo ``trigger_event``
   coincide con un evento de workflow (``checkout.created``,
   ``payment.completed``). Permanecen activas y solo se actualiza
   ``last_triggered_at``.

Segmentación (``segment_type``):
- ``"tags"``: audiencia por etiquetas vía ``IContactRepository.list_by_tags``
  con ``segment_config = {"tags": [...], "match": "any"|"all"}``.
- ``"event"`` / ``None``: en un disparo por evento, la audiencia es el contacto
  que originó el evento; en uno agendado, ``None`` = todos los contactos activos.

El dispatcher es a nivel de SISTEMA (sirve a todos los tenants); las consultas
``list_due_for_dispatch`` / ``list_by_trigger_event`` son la excepción
documentada al contrato multi-tenant. El contexto de request (contextvars) NO
atraviesa hilos, por lo que la auditoría pasa ``tenant_id`` de forma explícita.
"""

from __future__ import annotations

import csv
import io
import re
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.database import Database
from app.core.errors import InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotCampaignRecipientFile,
    BotContact,
    BotTemplate,
)
from app.repositories.operations_interfaces import (
    ICampaignRecipientRepository,
    ICampaignRepository,
    IContactRepository,
    IRecipientFileRepository,
)
from app.services.interfaces import IAuditService
from app.services.workflow_interfaces import IWhatsAppSender, IWhatsAppSenderFactory

# Operaciones de auditoría usadas por el dispatcher.
OPERATION_CAMPAIGN_DISPATCH = "campaign.dispatch"
OPERATION_CAMPAIGN_RECIPIENT_FAILED = "campaign.recipient.failed"
# Eventos de workflow que pueden disparar campañas (C-2, eslabones ⑦⑧⑨).
SUPPORTED_EVENTS = frozenset({"checkout.created", "payment.completed"})

# Estados de campaña.
CAMPAIGN_STATE_ACTIVE = "active"
CAMPAIGN_STATE_COMPLETED = "completed"
# Estados de destinatario.
RECIPIENT_STATE_PENDING = "pending"
RECIPIENT_STATE_SENT = "sent"
RECIPIENT_STATE_FAILED = "failed"
RECIPIENT_STATE_SKIPPED = "skipped"
# Tipos de segmentación.
SEGMENT_TYPE_TAGS = "tags"
SEGMENT_TYPE_EVENT = "event"

# Límite por tick para no hacer lotes infinitos.
_BATCH_LIMIT = 200
# Tamaño de página al materializar la audiencia "todos los contactos".
_DEFAULT_PAGE_SIZE = 500
# Regex de variables ``{{ var }}`` en el cuerpo de la plantilla.
_TEMPLATE_VAR_RE = re.compile(r"{{\s*([A-Za-z0-9_.]+)\s*}}")


@dataclass(frozen=True)
class CampaignDispatchResult:
    """Resultado de una pasada de disparo de campañas."""

    campaigns_processed: int = 0
    recipients_sent: int = 0
    recipients_failed: int = 0
    recipients_skipped: int = 0


class ICampaignDispatcher(ABC):
    """Puerto del dispatcher de campañas (regla CLAUDE: DI)."""

    @abstractmethod
    def dispatch_due(self) -> CampaignDispatchResult:
        """Despacha las campañas agendadas vencidas (one-shot)."""

    @abstractmethod
    def dispatch_event(
        self,
        *,
        tenant_id: uuid.UUID,
        event_type: str,
        contact_id: uuid.UUID,
        context: dict[str, object] | None = None,
    ) -> CampaignDispatchResult:
        """Despacha las campañas disparadas por un evento de workflow."""

    @abstractmethod
    def dispatch_campaign(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID
    ) -> CampaignDispatchResult:
        """Despacha manualmente una campaña concreta del tenant (inmediato)."""

    @abstractmethod
    def dispatch_campaign_from_file(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> CampaignDispatchResult:
        """Despacha una campaña usando un archivo de destinatarios reutilizable (GAP 2).

        Materializa los contactos del CSV (resolviendo o creando por ``phone`` en
        el directorio del tenant), los registra como destinatarios de la campaña
        y dispara el envío de forma inmediata.
        """

    @abstractmethod
    def send_individual(
        self,
        *,
        tenant_id: uuid.UUID,
        template_id: uuid.UUID,
        phone: str,
        contact_id: uuid.UUID | None = None,
        variables: dict[str, str] | None = None,
    ) -> tuple[str, str, uuid.UUID]:
        """Envía un mensaje individual (B.4) reutilizando una plantilla.

        Resuelve (o crea) el contacto por ``phone`` en el directorio del tenant,
        envía por el canal WhatsApp configurado y devuelve
        ``(estado, resultado, contact_id)``.
        """

    @abstractmethod
    def start(self) -> None:
        """Arranca el hilo de polling en segundo plano (no bloqueante)."""

    @abstractmethod
    def stop(self) -> None:
        """Detiene el hilo de polling y espera a que termine."""

    @property
    @abstractmethod
    def is_running(self) -> bool:
        """``True`` si el hilo de polling está activo."""


def _naive_utc(value: datetime) -> datetime:
    """Normaliza a UTC sin tzinfo para comparaciones consistentes con SQLite."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _stringify(value: object) -> str:
    """Convierte un valor de contexto a su representación textual para variables."""
    if value is None:
        return ""
    return str(value)


class CampaignDispatcher(ICampaignDispatcher):
    """Dispatcher con polling de la stdlib y fail-closed por tick.

    Dependencias inyectadas (DI): ``database`` (acceso a sesiones), fábricas
    session-scoped de repositorios y auditoría, y la fábrica de senders de
    WhatsApp por tenant (multi-WABA).
    """

    def __init__(
        self,
        *,
        database: Database,
        campaign_repository_factory: "callable[[Any], ICampaignRepository]",
        contact_repository_factory: "callable[[Any], IContactRepository]",
        recipient_repository_factory: "callable[[Any], ICampaignRecipientRepository]",
        recipient_file_repository_factory: "callable[[Any], IRecipientFileRepository]",
        audit_factory: "callable[[Any], IAuditService]",
        sender_factory: IWhatsAppSenderFactory,
        logger: ILogger,
        poll_interval_seconds: float = 60.0,
        batch_limit: int = _BATCH_LIMIT,
    ) -> None:
        self._database = database
        self._campaign_repository_factory = campaign_repository_factory
        self._contact_repository_factory = contact_repository_factory
        self._recipient_repository_factory = recipient_repository_factory
        self._recipient_file_repository_factory = recipient_file_repository_factory
        self._audit_factory = audit_factory
        self._sender_factory = sender_factory
        self._logger = logger
        self._poll_interval_seconds = poll_interval_seconds
        self._batch_limit = batch_limit
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    # ── Disparo agendado (one-shot) ─────────────────────────────────────────
    def dispatch_due(self) -> CampaignDispatchResult:
        with self._database.session_scope() as session:
            campaign_repo = self._campaign_repository_factory(session)
            contact_repo = self._contact_repository_factory(session)
            recipient_repo = self._recipient_repository_factory(session)
            audit = self._audit_factory(session)
            now = _naive_utc(datetime.now(timezone.utc))
            campaigns = campaign_repo.list_due_for_dispatch(
                now=now, batch_limit=self._batch_limit
            )
            totals = self._dispatch_campaigns(
                session=session,
                campaign_repo=campaign_repo,
                contact_repo=contact_repo,
                recipient_repo=recipient_repo,
                audit=audit,
                campaigns=campaigns,
                trigger_contact=None,
                event_context=None,
                mark_completed=True,
                now=now,
            )
        self._logger.info(
            "campaign.due.completed",
            campaigns=totals.campaigns_processed,
            sent=totals.recipients_sent,
            failed=totals.recipients_failed,
            skipped=totals.recipients_skipped,
        )
        return totals

    # ── Disparo por evento ──────────────────────────────────────────────────
    def dispatch_event(
        self,
        *,
        tenant_id: uuid.UUID,
        event_type: str,
        contact_id: uuid.UUID,
        context: dict[str, object] | None = None,
    ) -> CampaignDispatchResult:
        if event_type not in SUPPORTED_EVENTS:
            raise InputValidationError(
                f"evento no soportado para disparo de campañas: {event_type}",
                operation=OPERATION_CAMPAIGN_DISPATCH,
                context={"supported": sorted(SUPPORTED_EVENTS)},
            )
        with self._database.session_scope() as session:
            campaign_repo = self._campaign_repository_factory(session)
            contact_repo = self._contact_repository_factory(session)
            recipient_repo = self._recipient_repository_factory(session)
            audit = self._audit_factory(session)
            now = _naive_utc(datetime.now(timezone.utc))
            contact = contact_repo.get(tenant_id=tenant_id, contact_id=contact_id)
            if contact is None:
                raise NotFoundError(
                    f"contacto {contact_id} no encontrado para el disparo",
                    operation=OPERATION_CAMPAIGN_DISPATCH,
                    context={"tenant_id": str(tenant_id), "event_type": event_type},
                )
            campaigns = campaign_repo.list_by_trigger_event(
                event_type=event_type, limit=self._batch_limit
            )
            # El repo es de sistema (multi-tenant): se filtra por tenant en Python.
            campaigns = [c for c in campaigns if c.tenant_id == tenant_id]
            totals = self._dispatch_campaigns(
                session=session,
                campaign_repo=campaign_repo,
                contact_repo=contact_repo,
                recipient_repo=recipient_repo,
                audit=audit,
                campaigns=campaigns,
                trigger_contact=contact,
                event_context=context,
                mark_completed=False,
                now=now,
            )
        self._logger.info(
            "campaign.event.completed",
            event_type=event_type,
            tenant_id=str(tenant_id),
            campaigns=totals.campaigns_processed,
            sent=totals.recipients_sent,
            failed=totals.recipients_failed,
            skipped=totals.recipients_skipped,
        )
        return totals

    # ── Disparo manual (consola de operaciones) ─────────────────────────────
    def dispatch_campaign(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID
    ) -> CampaignDispatchResult:
        """Despacha una campaña concreta del tenant de forma inmediata.

        Usado por el endpoint ``POST /operations/campaigns/{id}/dispatch``:
        procesa la audiencia de la campaña (sin contacto disparador ni contexto
        de evento) y la marca como completada si existían destinatarios.
        """
        with self._database.session_scope() as session:
            campaign_repo = self._campaign_repository_factory(session)
            contact_repo = self._contact_repository_factory(session)
            recipient_repo = self._recipient_repository_factory(session)
            audit = self._audit_factory(session)
            now = _naive_utc(datetime.now(timezone.utc))
            campaign = campaign_repo.get(
                tenant_id=tenant_id, campaign_id=campaign_id
            )
            if campaign is None:
                raise NotFoundError(
                    f"campaña {campaign_id} no encontrada para el tenant",
                    operation=OPERATION_CAMPAIGN_DISPATCH,
                    context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
                )
            totals = self._dispatch_campaigns(
                session=session,
                campaign_repo=campaign_repo,
                contact_repo=contact_repo,
                recipient_repo=recipient_repo,
                audit=audit,
                campaigns=[campaign],
                trigger_contact=None,
                event_context=None,
                mark_completed=True,
                now=now,
            )
        self._logger.info(
            "campaign.manual.completed",
            tenant_id=str(tenant_id),
            campaign_id=str(campaign_id),
            campaigns=totals.campaigns_processed,
            sent=totals.recipients_sent,
            failed=totals.recipients_failed,
            skipped=totals.recipients_skipped,
        )
        return totals

    # ── Envío masivo desde archivo de destinatarios (GAP 2) ────────────────
    def dispatch_campaign_from_file(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> CampaignDispatchResult:
        """Despacha una campaña usando un archivo de destinatarios reutilizable.

        Materializa los contactos del CSV (resolviendo o creando por ``phone``
        en el directorio del tenant), los registra como destinatarios de la
        campaña (idempotente por campaña+contacto) y dispara el envío de forma
        inmediata. Usado por ``POST /operations/campaigns/{id}/dispatch-from-file``.
        """
        with self._database.session_scope() as session:
            campaign_repo = self._campaign_repository_factory(session)
            contact_repo = self._contact_repository_factory(session)
            recipient_repo = self._recipient_repository_factory(session)
            recipient_file_repo = self._recipient_file_repository_factory(session)
            audit = self._audit_factory(session)
            now = _naive_utc(datetime.now(timezone.utc))
            campaign = campaign_repo.get(
                tenant_id=tenant_id, campaign_id=campaign_id
            )
            if campaign is None:
                raise NotFoundError(
                    f"campaña {campaign_id} no encontrada para el tenant",
                    operation=OPERATION_CAMPAIGN_DISPATCH,
                    context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
                )
            recipient_file = recipient_file_repo.get(
                tenant_id=tenant_id, file_id=file_id
            )
            if recipient_file is None:
                raise NotFoundError(
                    f"archivo de destinatarios {file_id} no encontrado para el tenant",
                    operation=OPERATION_CAMPAIGN_DISPATCH,
                    context={"tenant_id": str(tenant_id), "file_id": str(file_id)},
                )
            audience = self._materialize_file_contacts(
                contact_repo=contact_repo,
                recipient_repo=recipient_repo,
                campaign=campaign,
                raw_csv=recipient_file.raw_csv,
            )
            totals = self._dispatch_campaigns(
                session=session,
                campaign_repo=campaign_repo,
                contact_repo=contact_repo,
                recipient_repo=recipient_repo,
                audit=audit,
                campaigns=[campaign],
                trigger_contact=None,
                event_context=None,
                mark_completed=True,
                now=now,
                audience=audience,
            )
        self._logger.info(
            "campaign.file.completed",
            tenant_id=str(tenant_id),
            campaign_id=str(campaign_id),
            file_id=str(file_id),
            audience=len(audience),
            campaigns=totals.campaigns_processed,
            sent=totals.recipients_sent,
            failed=totals.recipients_failed,
            skipped=totals.recipients_skipped,
        )
        return totals

    def _materialize_file_contacts(
        self,
        *,
        contact_repo: IContactRepository,
        recipient_repo: ICampaignRecipientRepository,
        campaign: BotCampaign,
        raw_csv: str,
    ) -> list[BotContact]:
        """Resuelve/crea los contactos del CSV y los registra como destinatarios.

        Cada fila debe traer ``phone`` (obligatorio). Los contactos ya vinculados
        a la campaña no se duplican (idempotencia por campaña+contacto). Devuelve
        la audiencia completa del archivo para el despacho inmediato; el despacho
        decide si cada contacto se envía, se omite (ya enviado) o se re-procesa.
        """
        tenant_id = campaign.tenant_id
        try:
            reader = csv.DictReader(io.StringIO(raw_csv))
            rows = list(reader)
        except csv.Error as exc:
            raise InputValidationError(
                f"CSV inválido en el archivo de destinatarios: {exc}",
                operation=OPERATION_CAMPAIGN_DISPATCH,
                context={"tenant_id": str(tenant_id), "campaign_id": str(campaign.id)},
            ) from exc
        audience: list[BotContact] = []
        for row in rows:
            phone = (row.get("phone") or "").strip()
            if not phone:
                continue
            contact = contact_repo.get_by_phone(tenant_id=tenant_id, phone=phone)
            if contact is None:
                contact = contact_repo.create(
                    tenant_id=tenant_id,
                    phone=phone,
                    name=(row.get("name") or "").strip() or None,
                    email=(row.get("email") or "").strip() or None,
                    tags=[],
                    state="new",
                    source="recipient_file",
                    external_contact_id=None,
                    last_contact_at=None,
                )
            existing = recipient_repo.get_by_campaign_and_contact(
                tenant_id=tenant_id,
                campaign_id=campaign.id,
                contact_id=contact.id,
            )
            if existing is None:
                recipient_repo.create(
                    tenant_id=tenant_id,
                    campaign_id=campaign.id,
                    contact_id=contact.id,
                    state=RECIPIENT_STATE_PENDING,
                    result=None,
                    attempts=0,
                )
            # La audiencia incluye todos los contactos del archivo: el despacho
            # decide idempotencia (ya enviado → skipped) y re-procesa el resto.
            audience.append(contact)
        return audience

    # ── Envío individual (B.4 — consola de operaciones) ─────────────────────
    def send_individual(
        self,
        *,
        tenant_id: uuid.UUID,
        template_id: uuid.UUID,
        phone: str,
        contact_id: uuid.UUID | None = None,
        variables: dict[str, str] | None = None,
    ) -> tuple[str, str, uuid.UUID]:
        """Envía un mensaje individual reutilizando una plantilla del tenant.

        Resuelve el contacto por ``contact_id`` (si se indica) o por ``phone``
        (creándolo si no existe en el directorio), envía por el canal WhatsApp
        configurado y devuelve ``(estado, resultado, contact_id)``. No crea
        destinatarios de campaña: es un envío puntual de operaciones.
        """
        with self._database.session_scope() as session:
            contact_repo = self._contact_repository_factory(session)
            audit = self._audit_factory(session)
            template = session.get(BotTemplate, template_id)
            if template is None or template.tenant_id != tenant_id:
                raise NotFoundError(
                    f"plantilla {template_id} no encontrada para el tenant",
                    operation=OPERATION_CAMPAIGN_DISPATCH,
                    context={"tenant_id": str(tenant_id), "template_id": str(template_id)},
                )
            if contact_id is not None:
                contact = contact_repo.get(tenant_id=tenant_id, contact_id=contact_id)
                if contact is None:
                    raise NotFoundError(
                        f"contacto {contact_id} no encontrado para el tenant",
                        operation=OPERATION_CAMPAIGN_DISPATCH,
                        context={"tenant_id": str(tenant_id), "contact_id": str(contact_id)},
                    )
            else:
                contact = contact_repo.get_by_phone(tenant_id=tenant_id, phone=phone)
                if contact is None:
                    contact = contact_repo.create(
                        tenant_id=tenant_id,
                        phone=phone,
                        name=None,
                        email=None,
                        tags=[],
                        state="new",
                        source="individual_send",
                        external_contact_id=None,
                        last_contact_at=None,
                    )
            sender = self._sender_factory.resolve_sender_for_tenant(tenant_id=tenant_id)
            if sender is None:
                state, result = RECIPIENT_STATE_SKIPPED, "sin canal WhatsApp habilitado"
            else:
                state, result = self._send_one(
                    sender,
                    template,
                    contact,
                    variables,
                    campaign_id=None,
                )
            if state == RECIPIENT_STATE_FAILED:
                self._audit(
                    audit,
                    tenant_id=tenant_id,
                    operation=OPERATION_CAMPAIGN_RECIPIENT_FAILED,
                    entity_type="contact",
                    entity_id=str(contact.id),
                    details={
                        "template_id": str(template.id),
                        "phone": contact.phone,
                        "result": result,
                        "mode": "individual",
                    },
                )
        self._logger.info(
            "campaign.individual.completed",
            tenant_id=str(tenant_id),
            template_id=str(template_id),
            contact_id=str(contact.id),
            state=state,
        )
        return state, result, contact.id

    # ── Procesamiento común ─────────────────────────────────────────────────
    def _dispatch_campaigns(
        self,
        *,
        session: Any,
        campaign_repo: ICampaignRepository,
        contact_repo: IContactRepository,
        recipient_repo: ICampaignRecipientRepository,
        audit: IAuditService,
        campaigns: list[BotCampaign],
        trigger_contact: BotContact | None,
        event_context: dict[str, object] | None,
        mark_completed: bool,
        now: datetime,
        audience: list[BotContact] | None = None,
    ) -> CampaignDispatchResult:
        totals = CampaignDispatchResult()
        for campaign in campaigns:
            if audience is None:
                audience = self._build_audience(
                    contact_repo, campaign, trigger_contact=trigger_contact
                )
            sent, failed, skipped = self._dispatch_campaign(
                session=session,
                recipient_repo=recipient_repo,
                audit=audit,
                campaign=campaign,
                audience=audience,
                event_context=event_context,
            )
            if mark_completed:
                campaign_repo.update(
                    tenant_id=campaign.tenant_id,
                    campaign_id=campaign.id,
                    fields={
                        "state": CAMPAIGN_STATE_COMPLETED,
                        "last_triggered_at": datetime.now(timezone.utc),
                    },
                )
            else:
                campaign_repo.update(
                    tenant_id=campaign.tenant_id,
                    campaign_id=campaign.id,
                    fields={"last_triggered_at": datetime.now(timezone.utc)},
                )
            self._audit(
                audit,
                tenant_id=campaign.tenant_id,
                operation=OPERATION_CAMPAIGN_DISPATCH,
                entity_type="campaign",
                entity_id=str(campaign.id),
                details={
                    "campaign": campaign.name,
                    "event_type": campaign.trigger_event,
                    "audience": len(audience),
                    "sent": sent,
                    "failed": failed,
                    "skipped": skipped,
                },
            )
            totals = CampaignDispatchResult(
                campaigns_processed=totals.campaigns_processed + 1,
                recipients_sent=totals.recipients_sent + sent,
                recipients_failed=totals.recipients_failed + failed,
                recipients_skipped=totals.recipients_skipped + skipped,
            )
        return totals

    def _build_audience(
        self,
        contact_repo: IContactRepository,
        campaign: BotCampaign,
        *,
        trigger_contact: BotContact | None,
    ) -> list[BotContact]:
        tenant_id = campaign.tenant_id
        segment_type = campaign.segment_type
        if segment_type == SEGMENT_TYPE_TAGS:
            config = campaign.segment_config or {}
            tags = [str(t) for t in (config.get("tags") or [])]
            match = str(config.get("match") or "any")
            return contact_repo.list_by_tags(tenant_id=tenant_id, tags=tags, match=match)
        if trigger_contact is not None:
            # Disparo por evento sin segmentación por etiquetas: el contacto
            # que originó el evento (mensaje individual de recompra).
            return [trigger_contact]
        if segment_type == SEGMENT_TYPE_EVENT:
            # Audiencia de evento sin contacto disparador → nada que enviar.
            return []
        # Sin segmentación en un disparo agendado: todos los contactos activos.
        contacts: list[BotContact] = []
        page = 1
        while True:
            batch, _ = contact_repo.list(
                tenant_id=tenant_id, page=page, page_size=_DEFAULT_PAGE_SIZE
            )
            contacts.extend(batch)
            if len(batch) < _DEFAULT_PAGE_SIZE:
                break
            page += 1
        return contacts

    def _dispatch_campaign(
        self,
        *,
        session: Any,
        recipient_repo: ICampaignRecipientRepository,
        audit: IAuditService,
        campaign: BotCampaign,
        audience: list[BotContact],
        event_context: dict[str, object] | None,
    ) -> tuple[int, int, int]:
        tenant_id = campaign.tenant_id
        sent = failed = skipped = 0
        template = (
            session.get(BotTemplate, campaign.template_id)
            if campaign.template_id is not None
            else None
        )
        if template is None:
            # Sin plantilla: no hay nada que enviar (fallo de configuración).
            # Se respeta la idempotencia por campaña+contacto: si el destinatario
            # ya fue materializado (p. ej. envío desde archivo), se actualiza en
            # lugar de duplicarlo.
            for contact in audience:
                existing = recipient_repo.get_by_campaign_and_contact(
                    tenant_id=tenant_id,
                    campaign_id=campaign.id,
                    contact_id=contact.id,
                )
                self._record_recipient(
                    recipient_repo, audit, campaign, contact,
                    RECIPIENT_STATE_SKIPPED, "sin plantilla de mensaje",
                    existing=existing,
                )
                skipped += 1
            return sent, failed, skipped
        sender = self._sender_factory.resolve_sender_for_tenant(tenant_id=tenant_id)
        for contact in audience:
            existing = recipient_repo.get_by_campaign_and_contact(
                tenant_id=tenant_id,
                campaign_id=campaign.id,
                contact_id=contact.id,
            )
            if existing is not None and existing.state == RECIPIENT_STATE_SENT:
                # Idempotencia: ya se entregó en una pasada anterior.
                skipped += 1
                continue
            if sender is None:
                state, result = RECIPIENT_STATE_SKIPPED, "sin canal WhatsApp habilitado"
            else:
                state, result = self._send_one(
                    sender,
                    template,
                    contact,
                    event_context,
                    campaign_id=campaign.id,
                )
            self._record_recipient(
                recipient_repo, audit, campaign, contact, state, result, existing=existing
            )
            sent += state == RECIPIENT_STATE_SENT
            failed += state == RECIPIENT_STATE_FAILED
            skipped += state == RECIPIENT_STATE_SKIPPED
        return sent, failed, skipped

    def _send_one(
        self,
        sender: IWhatsAppSender,
        template: BotTemplate,
        contact: BotContact,
        event_context: dict[str, object] | None,
        *,
        campaign_id: uuid.UUID | None = None,
    ) -> tuple[str, str]:
        """Envía el mensaje a un contacto. Devuelve (estado, resultado)."""
        variables = self._render_variables(contact, event_context)
        try:
            if template.template_type == "template":
                ok = sender.send_template_message(
                    to_phone=contact.phone,
                    template_name=template.name,
                    template_variables=variables,
                )
            else:
                ok = sender.send_text(
                    to_phone=contact.phone,
                    text=self._render_body(template.body, variables),
                )
            if ok:
                return RECIPIENT_STATE_SENT, "enviado"
            return RECIPIENT_STATE_FAILED, "proveedor rechazó el envío"
        except Exception as exc:  # fail-closed: un envío no tumba el ciclo
            self._logger.warning(
                "campaign.recipient.error",
                tenant_id=str(contact.tenant_id),
                campaign_id=str(campaign_id) if campaign_id is not None else None,
                contact_id=str(contact.id),
                error=str(exc),
            )
            return RECIPIENT_STATE_FAILED, f"error de envío: {type(exc).__name__}: {exc}"

    def _render_variables(
        self,
        contact: BotContact,
        event_context: dict[str, object] | None,
    ) -> dict[str, str]:
        """Construye las variables de la plantilla: contacto + contexto del evento."""
        variables: dict[str, str] = {
            "phone": contact.phone,
            "name": contact.name or "",
            "email": contact.email or "",
        }
        for key, value in (event_context or {}).items():
            variables[str(key)] = _stringify(value)
        return variables

    @staticmethod
    def _render_body(body: str, variables: dict[str, str]) -> str:
        """Sustituye ``{{ var }}`` por su valor (vacío si no existe la variable)."""
        return _TEMPLATE_VAR_RE.sub(lambda m: variables.get(m.group(1), ""), body)

    def _record_recipient(
        self,
        recipient_repo: ICampaignRecipientRepository,
        audit: IAuditService,
        campaign: BotCampaign,
        contact: BotContact,
        state: str,
        result: str,
        *,
        existing: BotCampaignRecipient | None,
    ) -> None:
        tenant_id = campaign.tenant_id
        if existing is None:
            created = recipient_repo.create(
                tenant_id=tenant_id,
                campaign_id=campaign.id,
                contact_id=contact.id,
                state=state,
                result=result,
                attempts=1,
            )
            recipient_id = str(created.id)
        else:
            recipient_repo.update(
                tenant_id=tenant_id,
                recipient_id=existing.id,
                fields={
                    "state": state,
                    "result": result,
                    "attempts": (existing.attempts or 0) + 1,
                },
            )
            recipient_id = str(existing.id)
        if state == RECIPIENT_STATE_FAILED:
            self._audit(
                audit,
                tenant_id=tenant_id,
                operation=OPERATION_CAMPAIGN_RECIPIENT_FAILED,
                entity_type="campaign_recipient",
                entity_id=recipient_id,
                details={
                    "campaign_id": str(campaign.id),
                    "contact_id": str(contact.id),
                    "result": result,
                },
            )

    def _audit(
        self,
        audit: IAuditService,
        *,
        tenant_id: uuid.UUID,
        operation: str,
        entity_type: str,
        entity_id: str,
        details: dict[str, object],
    ) -> None:
        try:
            audit.record(
                tenant_id=tenant_id,
                operation=operation,
                entity_type=entity_type,
                entity_id=entity_id,
                details=details,
            )
        except Exception as exc:
            # La auditoría no debe romper el ciclo: se registra y se continúa.
            self._logger.error(
                "campaign.audit.failed",
                operation=operation,
                entity_type=entity_type,
                entity_id=entity_id,
                error=str(exc),
            )

    # ── Ciclo de vida del hilo ───────────────────────────────────────────────
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="campaign-dispatcher",
            daemon=True,
        )
        self._thread.start()
        self._logger.info(
            "campaign.dispatcher.started", interval=self._poll_interval_seconds
        )

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=max(self._poll_interval_seconds * 2, 5.0))
        self._logger.info("campaign.dispatcher.stopped")

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.dispatch_due()
            except Exception as exc:
                # Fail-closed: un tick con error se loguea y se reintenta.
                self._logger.error(
                    "campaign.dispatcher.tick.error",
                    error=str(exc),
                )
            self._stop_event.wait(timeout=self._poll_interval_seconds)


__all__ = [
    "CAMPAIGN_STATE_ACTIVE",
    "CAMPAIGN_STATE_COMPLETED",
    "CampaignDispatchResult",
    "CampaignDispatcher",
    "ICampaignDispatcher",
    "OPERATION_CAMPAIGN_DISPATCH",
    "OPERATION_CAMPAIGN_RECIPIENT_FAILED",
    "RECIPIENT_STATE_FAILED",
    "RECIPIENT_STATE_PENDING",
    "RECIPIENT_STATE_SENT",
    "RECIPIENT_STATE_SKIPPED",
    "SEGMENT_TYPE_EVENT",
    "SEGMENT_TYPE_TAGS",
    "SUPPORTED_EVENTS",
]
