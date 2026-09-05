"""Servicio de conversación del bot (Fase 6) — un solo dueño por transacción.

El bot **nunca** reimplementa checkout, leads, cotizaciones o citas: delega cada
intención en los servicios de workflows existentes a través de inversión de
dependencias (regla CLAUDE: DI) y de los puertos ``IWorkflowService``,
``IAuditService`` y los repositorios del subsistema bot. Así:

- Un solo dueño por transacción (checkout → ``WorkflowService.create_checkout``).
- RLS multi-tenant sigue aplicando (cada operación se acota al ``tenant_id``
  del bundle resuelto por canal).
- La conversación general (sin intención de workflow) se delega al router de
  proveedores de respuesta IA (``local``/``llm``) con el contexto de la empresa.

El servicio es agnóstico del canal: ``handle_inbound`` recibe un
:class:`InboundMessage` ya normalizado y devuelve un :class:`BotResponse`. El
adaptador de envío se conectará en Fase 6.1 (hoy el worker queda dormant).
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from app.bot.context_bundle import CompanyContextBundle
from app.bot.context_bundle_service import ContextBundleService
from app.bot.interfaces import (
    BotResponse,
    ConversationContext,
    IChannelAdapter,
    IConversationService,
    InboundMessage,
    IResponseProvider,
    ProviderConfig,
    RouterStep,
    RouterTrace,
)
from app.bot.providers import build_response_provider_router
from app.bot.queue import (
    CONVERSATION_STATE_ACTIVE,
    DIRECTION_INBOUND,
    DIRECTION_OUTBOUND,
    QUEUE_SENT,
)
from app.bot.repository_interfaces import IBotConversationRepository, IBotMessageRepository
from app.config.settings import Settings
from app.core.database import Database
from app.core.logging import ILogger
from app.core.tenancy import set_app_current_tenant
from app.models.base import utcnow
from app.repositories.interfaces import IKeywordRepository
from app.schemas.workflow import (
    AppointmentRequest,
    CheckoutRequest,
    LeadRequest,
    QuoteLineItem,
    QuoteRequest,
)
from app.services.interfaces import IAuditService
from app.services.workflow_interfaces import IWorkflowService

# Historial máximo de turnos entregado a los proveedores de IA (contexto acotado).
_MAX_HISTORY_TURNS = 20

# Origen reportado a los workflows para transacciones originadas en el bot.
_LEAD_SOURCE = "bot"

# Provider sintético usado cuando responde una keyword priorizada del tenant (Fase 3).
_PROVIDER_KIND_KEYWORD = "keyword"

# Intenciones de workflow detectadas por palabras clave normalizadas.
_INTENTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("checkout", ("quiero comprar", "comprar", "pagar", "compra", "pago")),
    ("appointment", ("agenda", "agendar", "cita", "cita para", "reservar", "horario")),
    ("quote", ("cuanto cuesta", "cuanto vale", "precio", "cotiza", "cotizacion", "presupuesto")),
    ("lead", ("me interesa", "contactenme", "contactar", "contacto", "informacion", "prospecto")),
)

# Desempate cuando varias intenciones coinciden (menor = mayor prioridad).
_INTENT_PRIORITY: dict[str, int] = {
    "checkout": 0,
    "appointment": 1,
    "quote": 2,
    "lead": 3,
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_AMOUNT_RE = re.compile(r"(?<!\d)(\d{1,6}(?:[.,]\d{1,2})?)(?!\d)")
_DATETIME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})")

_NAME_PATTERNS = (
    re.compile(r"\bsoy\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+(?:\s+[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+){0,2})"),
    re.compile(r"\bme llamo\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+(?:\s+[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+){0,2})"),
)

# Alias de moneda normalizados (sin acentos). Se comparan con límites de palabra.
_CURRENCY_ALIASES: dict[str, tuple[str, ...]] = {
    "mxn": ("mxn", "pesos", "peso", "mx"),
    "usd": ("usd", "dolares", "dls", "us"),
    "eur": ("eur", "euros", "euro"),
}


@dataclass(frozen=True)
class KeywordMatch:
    """Keyword priorizada que responde de forma determinista antes del router IA."""

    term: str
    response: str
    priority: int


def _normalize(value: str) -> str:
    """Normaliza texto a minúsculas sin acentos ni diacríticos."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch)).lower()


def _safe_decimal(value: object) -> Decimal:
    """Convierte un valor a :class:`Decimal` de forma tolerante (0 si no puede)."""
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _intent_scores(text: str) -> dict[str, int]:
    """Puntaje por intención (coincidencia de palabras clave normalizadas)."""
    normalized = _normalize(text)
    return {
        intent: sum(normalized.count(keyword) for keyword in keywords)
        for intent, keywords in _INTENTS
    }


def _detect_intent(text: str) -> str | None:
    """Detecta la intención de workflow por coincidencia de palabras clave."""
    scores = _intent_scores(text)
    best = max(scores, key=lambda key: (scores[key], -_INTENT_PRIORITY[key]))
    return best if scores[best] > 0 else None


def _describe_intent_readiness(intent: str, text: str) -> str:
    """Describe qué datos de la intención ya trae el mensaje (sin bundle).

    Fase 4: el motor de prueba no resuelve bundle (el endpoint solo conoce el
    tenant), así que reporta los datos que el mensaje crudo ya contiene usando
    los extractores reales, sin delegar en workflows (no contamina datos).
    """
    if intent == "checkout":
        amount = _extract_amount(text)
        return f"monto presente: {amount}" if amount is not None else "falta el monto (delegaría a clarificación)"
    if intent == "lead":
        email = _extract_email(text)
        return f"correo presente: {email}" if email is not None else "falta el correo (delegaría a clarificación)"
    if intent == "quote":
        return "requiere el catálogo de servicios (no disponible sin canal)"
    if intent == "appointment":
        when = _extract_datetime(text)
        return (
            f"fecha/hora presente: {when:%Y-%m-%d %H:%M}"
            if when is not None
            else "falta fecha/hora (delegaría a clarificación)"
        )
    return "intención detectada"


def _extract_email(text: str) -> str | None:
    """Extrae el primer correo electrónico válido (o ``None``)."""
    match = _EMAIL_RE.search(text)
    return match.group(0) if match else None


def _extract_phone(text: str) -> str | None:
    """Extrae y normaliza el primer teléfono (solo dígitos, más ``+`` inicial)."""
    match = _PHONE_RE.search(text)
    if match is None:
        return None
    return re.sub(r"[\s().-]", "", match.group(0))


def _extract_amount(text: str) -> Decimal | None:
    """Extrae el primer monto positivo (pesos/dólares) del texto.

    Primero descarta fechas y teléfonos para no capturar sus dígitos sueltos.
    """
    cleaned = _DATETIME_RE.sub(" ", text)
    cleaned = _PHONE_RE.sub(" ", cleaned)
    match = _AMOUNT_RE.search(cleaned)
    if match is None:
        return None
    raw = match.group(1).replace(",", ".")
    amount = _safe_decimal(raw)
    return amount if amount > 0 else None


def _extract_datetime(text: str) -> datetime | None:
    """Extrae la primera fecha/hora ``AAAA-MM-DD HH:MM`` (UTC tz-aware)."""
    match = _DATETIME_RE.search(text)
    if match is None:
        return None
    try:
        return datetime.fromisoformat(f"{match.group(1)} {match.group(2)}").replace(tzinfo=UTC)
    except ValueError:
        return None


def _extract_currency(text: str, bundle: CompanyContextBundle) -> str:
    """Resuelve la moneda: alias en el texto → catálogo → ``usd`` por defecto."""
    normalized = _normalize(text)
    for code, aliases in _CURRENCY_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", normalized):
                return code
    for item in bundle.catalog_items:
        currency = str(item.get("currency") or "").strip().lower()[:3]
        if currency:
            return currency
    return "usd"


def _extract_name(text: str, external_contact_id: str) -> str:
    """Resuelve el nombre del cliente: patrón → correo → contacto externo."""
    for pattern in _NAME_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1)[:255]
    email = _extract_email(text)
    if email:
        return email.split("@", 1)[0][:255]
    if external_contact_id:
        return external_contact_id[:255]
    return "Cliente"


def _match_catalog_services(text: str, bundle: CompanyContextBundle) -> tuple[list[QuoteLineItem], str]:
    """Construye las líneas de cotización para los servicios del catálogo mencionados."""
    normalized_text = _normalize(text)
    lines: list[QuoteLineItem] = []
    currency = "usd"
    for item in bundle.catalog_items:
        if not item.get("available", True):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        if _normalize(name) not in normalized_text:
            continue
        price = _safe_decimal(item.get("price"))
        if price <= 0:
            continue
        description = str(item.get("description") or "").strip()
        lines.append(
            QuoteLineItem(
                name=name[:255],
                description=(description[:2000] or None),
                quantity=1,
                unit_price=price,
            )
        )
        currency = str(item.get("currency") or "").strip().lower()[:3] or "usd"
    return lines, currency


def _match_service_name(text: str, bundle: CompanyContextBundle) -> str | None:
    """Devuelve el primer servicio del catálogo (disponible) mencionado en el texto."""
    normalized_text = _normalize(text)
    for item in bundle.catalog_items:
        if not item.get("available", True):
            continue
        name = str(item.get("name") or "").strip()
        if name and _normalize(name) in normalized_text:
            return name[:255]
    return None


def _available_services(bundle: CompanyContextBundle) -> list[str]:
    """Lista de servicios disponibles del catálogo (acotada para clarificación)."""
    services: list[str] = []
    for item in bundle.catalog_items:
        if not item.get("available", True):
            continue
        name = str(item.get("name") or "").strip()
        if name:
            services.append(name[:255])
        if len(services) >= 8:
            break
    return services


class ConversationService(IConversationService):
    """Caso de uso de conversación del bot (Fase 6) — delega en workflows por DI."""

    def __init__(
        self,
        *,
        database: Database,
        context_bundle_service: ContextBundleService,
        settings: Settings,
        logger: ILogger,
        conversation_repository_factory: Callable[[Session], IBotConversationRepository],
        message_repository_factory: Callable[[Session], IBotMessageRepository],
        keyword_repository_factory: Callable[[Session], IKeywordRepository],
        audit_service_factory: Callable[[Session], IAuditService],
        workflow_service_factory: Callable[[Session], IWorkflowService],
        provider_router_factory: Callable[..., IResponseProvider] = build_response_provider_router,
    ) -> None:
        self._database = database
        self._context_bundle_service = context_bundle_service
        self._settings = settings
        self._logger = logger
        self._conversation_repository_factory = conversation_repository_factory
        self._message_repository_factory = message_repository_factory
        self._keyword_repository_factory = keyword_repository_factory
        self._audit_service_factory = audit_service_factory
        self._workflow_service_factory = workflow_service_factory
        self._provider_router_factory = provider_router_factory

    # ── Punto de entrada -----------------------------------------------------
    def handle_inbound(
        self,
        *,
        message: InboundMessage,
        adapter: IChannelAdapter,
    ) -> BotResponse:
        """Procesa un mensaje entrante y devuelve la respuesta del bot.

        El parámetro ``adapter`` se usa en Fase 6.1 para enviar la respuesta por
        el canal del mensaje (``adapter.send``) ANTES de persistir el outbound:
        si el envío falla se lanza ``RuntimeError`` para que el worker reintente
        (o mueva a DLQ) sin duplicar mensajes salientes.
        """
        bundle = self._context_bundle_service.get_bundle(channel_id=message.channel_id)

        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(bundle.tenant_id))
            conversation_repo = self._conversation_repository_factory(session)
            conversation = conversation_repo.upsert(
                tenant_id=bundle.tenant_id,
                channel_id=bundle.channel_id,
                external_contact_id=message.external_contact_id,
                state=CONVERSATION_STATE_ACTIVE,
                last_message_at=utcnow(),
            )

            # Procedencia del lead (eslabón ① → ③): si el contacto ya fue
            # capturado como lead en una landing con atribución de campaña
            # (mismo teléfono = ``external_contact_id`` de WhatsApp), se hereda
            # ``ad_campaign_id`` a la conversación para que el BOT muestre de
            # qué landing/campaña vino el contacto. Best-effort y solo si aún no
            # tiene campaña asignada (no pisa una atribución ya resuelta).
            workflow = self._workflow_service_factory(session)
            if conversation.ad_campaign_id is None:
                try:
                    lead = workflow.find_lead_by_phone(
                        tenant_id=bundle.tenant_id,
                        phone=message.external_contact_id,
                    )
                    if lead is not None and lead.ad_campaign_id is not None:
                        conversation.ad_campaign_id = lead.ad_campaign_id
                except Exception as exc:
                    self._logger.warning(
                        "bot.conversation.attribution_failed",
                        message="No se pudo heredar la campaña del lead a la conversación",
                        conversation_id=str(conversation.id),
                        error=str(exc),
                    )

            message_repo = self._message_repository_factory(session)
            history = self._load_history(
                message_repo,
                tenant_id=bundle.tenant_id,
                conversation_id=conversation.id,
            )

            keyword_match = self._match_keyword(
                session=session,
                tenant_id=bundle.tenant_id,
                text=message.text,
            )
            intent = _detect_intent(message.text) if keyword_match is None else None
            if keyword_match is not None:
                response = BotResponse(
                    content=keyword_match.response,
                    provider_kind=_PROVIDER_KIND_KEYWORD,
                    provider_used=keyword_match.term,
                    tokens_used=0,
                    needs_human=False,
                )
            elif intent is not None:
                response = self._handle_workflow_intent(
                    intent=intent,
                    workflow=workflow,
                    bundle=bundle,
                    message=message,
                )
            else:
                response = self._general_chat(
                    bundle=bundle,
                    message=message,
                    conversation_id=conversation.id,
                    history=history,
                )

            sent = adapter.send(reply=response, message=message)
            if not sent:
                raise RuntimeError("No se pudo enviar la respuesta por el canal")

            outbound = message_repo.create(
                tenant_id=bundle.tenant_id,
                conversation_id=conversation.id,
                direction=DIRECTION_OUTBOUND,
                content=response.content,
                provider_used=response.provider_used,
                tokens_used=response.tokens_used,
                message_id=None,
                queue_status=QUEUE_SENT,
            )

            self._audit_service_factory(session).record(
                tenant_id=bundle.tenant_id,
                operation="bot.conversation.reply",
                entity_type="bot_message",
                entity_id=str(outbound.id),
                details={
                    "conversation_id": str(conversation.id),
                    "intent": intent,
                    "keyword": keyword_match.term if keyword_match is not None else None,
                    "keyword_priority": keyword_match.priority if keyword_match is not None else None,
                    "provider_kind": response.provider_kind,
                    "provider_used": response.provider_used,
                    "needs_human": response.needs_human,
                    "channel_id": str(bundle.channel_id),
                    "external_contact_id": message.external_contact_id,
                },
            )

        self._logger.info(
            "bot.conversation.replied",
            "Respuesta del bot persistida",
            conversation_id=str(conversation.id),
            intent=intent,
            keyword=keyword_match.term if keyword_match is not None else None,
            keyword_priority=keyword_match.priority if keyword_match is not None else None,
            provider_kind=response.provider_kind,
            provider_used=response.provider_used,
            needs_human=response.needs_human,
        )
        return response

    # ── Motor de prueba del router (Fase 4) ----------------------------------
    def route_for_test(self, *, tenant_id: uuid.UUID, message: str) -> RouterTrace:
        """Traza qué rama del router decidiría para un mensaje crudo, sin efectos.

        Reproduce exactamente la jerarquía real de :meth:`handle_inbound`
        (keyword → intent → general_chat) REUTILIZANDO las mismas ramas, pero
        sin persistir conversaciones, encolar mensajes, llamar a workflows ni
        invocar al proveedor de IA. Es el motor de "Probar router" (Fase 4):
        escribir un mensaje crudo y ver qué rama decide y por qué, sin
        contaminar datos.

        El endpoint solo conoce el ``tenant_id`` (no hay canal/bundle), así que
        en la rama ``general_chat`` no hay proveedor que invocar: se reporta la
        decisión de caer al router IA sin consumir tokens ni producir efectos.
        """
        steps: list[RouterStep] = []

        # Paso 1 — keyword priorizada del tenant (determinista, sin IA).
        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(tenant_id))
            match = self._match_keyword(
                session=session,
                tenant_id=tenant_id,
                text=message,
            )

        if match is not None:
            steps.append(
                RouterStep(
                    order=1,
                    branch="keyword",
                    outcome="match",
                    detail=f"keyword '{match.term}' (prioridad {match.priority})",
                )
            )
            return RouterTrace(
                matched_route="keyword",
                branch="keyword",
                keyword=match.term,
                keyword_priority=match.priority,
                intent=None,
                response=match.response,
                confidence=1.0,
                steps=steps,
            )

        steps.append(
            RouterStep(
                order=1,
                branch="keyword",
                outcome="no_match",
                detail="ninguna keyword coincide con el mensaje",
            )
        )

        # Paso 2 — intención de workflow (checkout/lead/quote/appointment).
        scores = _intent_scores(message)
        intent = _detect_intent(message)
        if intent is not None:
            total = sum(scores.values())
            confidence = round(scores[intent] / total, 2) if total > 0 else 0.0
            readiness = _describe_intent_readiness(intent, message)
            steps.append(
                RouterStep(
                    order=2,
                    branch=f"intent:{intent}",
                    outcome="match",
                    detail=(
                        f"intención '{intent}' (score {scores[intent]}, "
                        f"confianza {confidence}) — {readiness}"
                    ),
                )
            )
            return RouterTrace(
                matched_route="intent",
                branch=f"intent:{intent}",
                keyword=None,
                keyword_priority=None,
                intent=intent,
                response=readiness,
                confidence=confidence,
                steps=steps,
            )

        steps.append(
            RouterStep(
                order=2,
                branch="intent",
                outcome="no_match",
                detail="sin intención de workflow detectada",
            )
        )

        # Paso 3 — conversación general (router IA). Sin bundle no hay LLM.
        steps.append(
            RouterStep(
                order=3,
                branch="general_chat",
                outcome="fallthrough",
                detail=(
                    "sin keyword ni intención; delegaría en el router de "
                    "proveedores IA (no disponible sin canal)"
                ),
            )
        )
        return RouterTrace(
            matched_route="general_chat",
            branch="general_chat",
            keyword=None,
            keyword_priority=None,
            intent=None,
            response=None,
            confidence=0.0,
            steps=steps,
        )

    # ── Keywords priorizadas -------------------------------------------------
    def _match_keyword(
        self,
        *,
        session: Session,
        tenant_id: uuid.UUID,
        text: str,
    ) -> KeywordMatch | None:
        """Devuelve la keyword priorizada que coincide (orden determinista por prioridad)."""
        normalized = _normalize(text)
        repository = self._keyword_repository_factory(session)
        for keyword in repository.list_enabled(tenant_id=tenant_id):
            if _normalize(keyword.term) in normalized:
                return KeywordMatch(
                    term=keyword.term,
                    response=keyword.response,
                    priority=keyword.priority,
                )
        return None

    # ── Historial ------------------------------------------------------------
    def _load_history(
        self,
        message_repo: IBotMessageRepository,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
    ) -> tuple[dict[str, str], ...]:
        """Carga el historial de la conversación (turnos invertidos, acotado)."""
        rows = message_repo.list_by_conversation(tenant_id=tenant_id, conversation_id=conversation_id)
        turns: list[dict[str, str]] = []
        for row in reversed(rows):
            content = (row.content or "").strip()
            if not content:
                continue
            role = "user" if row.direction == DIRECTION_INBOUND else "assistant"
            turns.append({"role": role, "content": content})
        return tuple(turns[-_MAX_HISTORY_TURNS:])

    # ── Conversación general -------------------------------------------------
    def _general_chat(
        self,
        *,
        bundle: CompanyContextBundle,
        message: InboundMessage,
        conversation_id: uuid.UUID,
        history: tuple[dict[str, str], ...],
    ) -> BotResponse:
        """Responde con el router de proveedores IA usando el contexto de la empresa."""
        provider = self._select_provider(bundle)
        context = ConversationContext(
            tenant_id=bundle.tenant_id,
            conversation_id=conversation_id,
            channel_id=bundle.channel_id,
            external_contact_id=message.external_contact_id,
            provider=provider,
            history=history,
        )
        router = self._provider_router_factory(
            bundle,
            base_url=self._settings.bot_llm_base_url,
            timeout_seconds=self._settings.bot_llm_timeout_seconds,
            default_model=self._settings.bot_llm_default_model,
            cache_ttl_seconds=self._settings.bot_llm_cache_ttl_seconds,
            logger=self._logger,
        )
        try:
            return router.respond(user_message=message.text, conversation_context=context)
        finally:
            router.close()

    @staticmethod
    def _select_provider(bundle: CompanyContextBundle) -> ProviderConfig:
        """Selecciona el primer proveedor habilitado por orden/tipo (o local sintético)."""
        enabled = [provider for provider in bundle.providers if provider.enabled]
        if not enabled:
            return ProviderConfig(
                provider_id=uuid.uuid4(),
                provider_kind="local",
                order=0,
                enabled=True,
            )
        return sorted(enabled, key=lambda provider: (provider.order, provider.provider_kind))[0]

    # ── Delegación a workflows -----------------------------------------------
    def _handle_workflow_intent(
        self,
        *,
        intent: str,
        workflow: IWorkflowService,
        bundle: CompanyContextBundle,
        message: InboundMessage,
    ) -> BotResponse:
        """Despacha la intención al workflow correspondiente (un solo dueño)."""
        if intent == "checkout":
            return self._handle_checkout(bundle=bundle, workflow=workflow, message=message)
        if intent == "lead":
            return self._handle_lead(bundle=bundle, workflow=workflow, message=message)
        if intent == "quote":
            return self._handle_quote(bundle=bundle, workflow=workflow, message=message)
        if intent == "appointment":
            return self._handle_appointment(bundle=bundle, workflow=workflow, message=message)
        raise ValueError(f"Intención de workflow desconocida: {intent}")

    def _handle_checkout(
        self,
        *,
        bundle: CompanyContextBundle,
        workflow: IWorkflowService,
        message: InboundMessage,
    ) -> BotResponse:
        """Delega el checkout en ``WorkflowService.create_checkout``."""
        amount = _extract_amount(message.text)
        if amount is None:
            return self._clarify("checkout", bundle)
        currency = _extract_currency(message.text, bundle)
        data = CheckoutRequest(
            amount=amount,
            currency=currency,
            customer_email=_extract_email(message.text),
            customer_name=_extract_name(message.text, message.external_contact_id),
            metadata={
                "source": _LEAD_SOURCE,
                "channel_type": bundle.channel_type,
            },
        )
        result = workflow.create_checkout(tenant_id=bundle.tenant_id, data=data)
        lines = [
            f"Listo, generé tu orden de pago por {amount} {currency.upper()}.",
            f"Referencia: {result.payment_id}",
        ]
        if result.checkout_url:
            lines.append(f"Completa tu pago aquí: {result.checkout_url}")
        return BotResponse(
            content="\n".join(lines),
            provider_kind="workflow",
            provider_used="checkout",
            metadata={
                "intent": "checkout",
                "payment_id": str(result.payment_id),
                "status": result.status,
                "checkout_url": result.checkout_url,
            },
        )

    def _handle_lead(
        self,
        *,
        bundle: CompanyContextBundle,
        workflow: IWorkflowService,
        message: InboundMessage,
    ) -> BotResponse:
        """Delega la captura de prospecto en ``WorkflowService.capture_lead``."""
        email = _extract_email(message.text)
        if email is None:
            # El correo es obligatorio en LeadRequest: nunca se fabrica un valor.
            return self._clarify("lead", bundle)
        data = LeadRequest(
            name=_extract_name(message.text, message.external_contact_id),
            email=email,
            phone=_extract_phone(message.text),
            source=_LEAD_SOURCE,
            metadata={
                "channel_type": bundle.channel_type,
                "external_contact_id": message.external_contact_id,
            },
        )
        result = workflow.capture_lead(tenant_id=bundle.tenant_id, data=data)
        return BotResponse(
            content=f"¡Gracias {result.name}! Hemos registrado tus datos y un asesor te contactará pronto.",
            provider_kind="workflow",
            provider_used="lead",
            metadata={
                "intent": "lead",
                "lead_id": str(result.id),
            },
        )

    def _handle_quote(
        self,
        *,
        bundle: CompanyContextBundle,
        workflow: IWorkflowService,
        message: InboundMessage,
    ) -> BotResponse:
        """Delega la cotización en ``WorkflowService.generate_quote``."""
        services, currency = _match_catalog_services(message.text, bundle)
        if not services:
            return self._clarify("quote", bundle)
        data = QuoteRequest(
            customer_name=_extract_name(message.text, message.external_contact_id),
            customer_email=_extract_email(message.text),
            currency=currency,
            services=services,
        )
        result = workflow.generate_quote(tenant_id=bundle.tenant_id, data=data)
        lines = [
            "Aquí está tu cotización:",
            f"- Subtotal: {result.subtotal} {currency.upper()}",
            f"- Impuestos: {result.tax} {currency.upper()}",
            f"- Total: {result.total} {currency.upper()}",
        ]
        if result.pdf_url:
            lines.append(f"Descarga el PDF: {result.pdf_url}")
        return BotResponse(
            content="\n".join(lines),
            provider_kind="workflow",
            provider_used="quote",
            metadata={
                "intent": "quote",
                "quote_id": str(result.quote_id),
                "status": result.status,
                "pdf_url": result.pdf_url,
            },
        )

    def _handle_appointment(
        self,
        *,
        bundle: CompanyContextBundle,
        workflow: IWorkflowService,
        message: InboundMessage,
    ) -> BotResponse:
        """Delega el agendamiento en ``WorkflowService.schedule_appointment``."""
        service = _match_service_name(message.text, bundle)
        starts_at = _extract_datetime(message.text)
        if service is None or starts_at is None:
            return self._clarify("appointment", bundle)
        data = AppointmentRequest(
            service=service,
            starts_at=starts_at,
            customer_name=_extract_name(message.text, message.external_contact_id),
            customer_email=_extract_email(message.text),
            customer_phone=_extract_phone(message.text),
            notes=message.text[:2000],
        )
        result = workflow.schedule_appointment(tenant_id=bundle.tenant_id, data=data)
        lines = [f"¡Listo! Tu cita para {service} quedó agendada para el {result.starts_at.isoformat()}."]
        if result.ics_url:
            lines.append(f"Descarga tu invitación: {result.ics_url}")
        return BotResponse(
            content="\n".join(lines),
            provider_kind="workflow",
            provider_used="appointment",
            metadata={
                "intent": "appointment",
                "appointment_id": str(result.appointment_id),
                "status": result.status,
                "ics_url": result.ics_url,
            },
        )

    # ── Clarificación --------------------------------------------------------
    def _clarify(self, intent: str, bundle: CompanyContextBundle) -> BotResponse:
        """Devuelve un mensaje pidiendo el dato faltante para completar la transacción."""
        services = _available_services(bundle)
        if intent == "checkout":
            text = "Claro, con gusto. Para generar tu orden de pago, ¿me indicas el monto a pagar?"
        elif intent == "lead":
            text = "Con gusto te contactamos. Para registrarte necesito tu correo electrónico, por favor."
        elif intent == "quote":
            if services:
                listing = "\n".join(f"- {service}" for service in services)
                text = f"Claro. ¿Sobre cuál de estos servicios quieres tu cotización?\n{listing}"
            else:
                text = "Claro. Cuéntame sobre el servicio que te gustaría cotizar."
        elif intent == "appointment":
            if services:
                listing = "\n".join(f"- {service}" for service in services)
                text = (
                    "Perfecto. ¿Para qué servicio y a qué día/hora te gustaría agendar? "
                    f"(formato AAAA-MM-DD HH:MM)\n{listing}"
                )
            else:
                text = (
                    "Perfecto. ¿Para qué día y hora te gustaría agendar tu cita? "
                    "(formato AAAA-MM-DD HH:MM)"
                )
        else:
            text = "¿Podrías indicarme con más detalle qué necesitas?"
        return BotResponse(
            content=text,
            provider_kind="conversation",
            provider_used="clarify",
            metadata={"intent": intent, "clarify": True},
        )
