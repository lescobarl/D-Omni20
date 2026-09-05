"""Endpoints runtime del bot (Fase 5/5.1): webhooks WhatsApp, cola D3 + context m2m.

Contrato (plan §8.3):
- ``GET /channels/whatsapp/webhook``: handshake de Meta. El ``hub.verify_token``
  NO es un valor local: se resuelve desde los canales configurados
  (``resolve_by_verify_token``) comparándolo con el ``webhook_secret`` descifrado
  de cada canal habilitado. Fail-closed: si no hay coincidencia o la estructura
  es inválida se responde 403; si es válida se devuelve el challenge como texto
  plano (Meta espera ese eco exacto).
- ``POST /channels/whatsapp/webhook``: mensajes entrantes. Se lee el cuerpo crudo
 para verificar la firma ``X-Hub-Signature-256`` con el ``webhook_secret`` del
 canal (no el global del sender), se resuelve canal → tenant por
 ``phone_number_id``, se normaliza el mensaje, se fija el contexto de empresa
 (``company_scope``) y se encola en la cola D3 (Fase 5.1): ``BotQueueService``
 persiste en BD (fuente de verdad) → ``XADD`` a ``bot:queue:{tenant_id}`` →
 200; at-least-once con idempotencia por ``message_id``.
- ``GET /queue/stats``: estadísticas de la cola Redis D3 de un tenant (m2m,
 service credential): BD (fuente de verdad) + Redis (cola viva) + DLQ.
- ``GET /context/{channel_id}``: context bundle m2m (solo-máquina) con el
  service credential; NO lleva ``X-Tenant-Id`` (resolución canal → tenant en
  contexto de servicio) y expone los secretos descifrados solo en memoria.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import (
    get_bot_conversation_repository,
    get_bot_message_repository,
    get_bot_privacy_service,
    get_bot_provider_repository,
    get_bot_queue_service,
    get_bot_quota_service,
    get_container,
    get_context_bundle_service,
    get_conversation_service,
    get_current_tenant,
    get_session,
    get_tenant_channel_repository,
    get_whatsapp_channel_adapter,
    require_role,
    require_service_credential,
)
from app.bot.company_context import CompanyContext, company_scope
from app.bot.context_bundle_service import ContextBundleService
from app.bot.governance import IPrivacyService, IQuotaService
from app.bot.interfaces import IChannelAdapter, IConversationService
from app.bot.queue.service import (
    DIRECTION_INBOUND,
    DIRECTION_OUTBOUND,
    QUEUE_PENDING,
    BotQueueService,
)
from app.bot.repository_interfaces import (
    IBotConversationRepository,
    IBotMessageRepository,
    IBotProviderRepository,
)
from app.core.di import Container
from app.core.errors import (
    DependencyError,
    InputValidationError,
    NotFoundError,
    TenantIsolationError,
)
from app.models.user import Role, User
from app.repositories.interfaces import ITenantChannelRepository
from app.schemas.bot import (
    BotDataExportRead,
    BotProviderConfigRead,
    BotProviderUpsert,
    ContextBundleRead,
    ConversationRead,
    MessageCreate,
    MessageEnqueueResult,
    MessageRead,
    PrivacyDeletionResult,
    QueueStatsRead,
    QuotaUsageResponse,
)
from app.schemas.common import Page, Pagination
from app.schemas.router_test import RouterTestRequest, RouterTraceRead

router = APIRouter(prefix="/bot", tags=["bot"])


@router.get("/channels/whatsapp/webhook")
def verify_whatsapp_webhook(
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    adapter: Annotated[IChannelAdapter, Depends(get_whatsapp_channel_adapter)],
    container: Annotated[Container, Depends(get_container)],
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    """Handshake ``GET`` del webhook de WhatsApp (Meta).

    Diseño (plan §8.3, línea 249): el ``verify_token`` se resuelve desde los
    canales configurados, nunca localmente. Si el token no coincide con ningún
    canal habilitado se responde 403 (fail-closed); si la estructura del
    handshake es inválida también 403. En caso contrario se devuelve el challenge
    como ``text/plain`` (Meta exige ese eco exacto).
    """
    channel = repository.resolve_by_verify_token(verify_token=hub_verify_token or "")
    if channel is None:
        container.logger.warning(
            "bot.webhook.verify.token_rejected",
            "verify_token no corresponde a ningún canal habilitado",
            has_mode=bool(hub_mode),
            has_challenge=bool(hub_challenge),
        )
        raise TenantIsolationError(
            "verify_token no corresponde a ningún canal habilitado",
            operation="bot.webhook.verify",
            context={"has_mode": bool(hub_mode), "has_challenge": bool(hub_challenge)},
        )

    challenge = adapter.verify_webhook(
        mode=hub_mode,
        verify_token=hub_verify_token,
        challenge=hub_challenge,
    )
    if challenge is None:
        container.logger.warning(
            "bot.webhook.verify.handshake_rejected",
            "Handshake del webhook de WhatsApp inválido",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            mode=hub_mode,
        )
        raise TenantIsolationError(
            "Handshake del webhook de WhatsApp inválido",
            operation="bot.webhook.verify",
            context={"channel_id": str(channel.id), "mode": hub_mode},
        )

    container.logger.info(
        "bot.webhook.verified",
        "Webhook de WhatsApp verificado por Meta",
        channel_id=str(channel.id),
        tenant_id=str(channel.tenant_id),
    )
    return PlainTextResponse(challenge)


@router.post("/channels/whatsapp/webhook")
async def receive_whatsapp_webhook(
    request: Request,
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    adapter: Annotated[IChannelAdapter, Depends(get_whatsapp_channel_adapter)],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
    container: Annotated[Container, Depends(get_container)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Recibe el webhook ``POST`` de WhatsApp (mensajes entrantes).

    Flujo (Fase 5.1 — cola D3): lee el cuerpo crudo (necesario para verificar la
    firma) → extrae el ``phone_number_id`` → resuelve canal → tenant → verifica la
    firma con el ``webhook_secret`` del canal (no el global) → normaliza el
    mensaje → fija el contexto de empresa → persiste y encola vía
    ``BotQueueService.enqueue_inbound`` (punto único de entrada, at-least-once).
    Todo evento sin mensaje o de un canal desconocido se confirma con 200 (Meta
    reintenta los no-200).
    """
    raw = await request.body()
    try:
        data: Any = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise InputValidationError(
            "Cuerpo del webhook no es JSON válido",
            operation="bot.webhook.inbound",
        ) from None
    if not isinstance(data, dict):
        raise InputValidationError(
            "Cuerpo del webhook debe ser un objeto JSON",
            operation="bot.webhook.inbound",
        )

    phone_number_id = adapter.extract_phone_number_id(data)
    channel = (
        repository.resolve_by_phone_number_id(phone_number_id=phone_number_id)
        if phone_number_id
        else None
    )
    if channel is None:
        container.logger.info(
            "bot.webhook.channel_unknown",
            "Evento de WhatsApp sin canal resoluble; se confirma 200",
            phone_number_id=phone_number_id,
        )
        return {"status": "ok"}

    # Cierra la transacción de lectura del request (BEGIN IMMEDIATE en SQLite
    # adquiere un bloqueo RESERVED). Liberar el lock aquí permite que
    # ``enqueue_inbound`` abra su propia ``session_scope()`` sin chocar con
    # "database is locked". En PostgreSQL es un cierre temprano inofensivo de la
    # transacción de lectura; ``expire_on_commit=False`` mantiene ``channel``
    # válido tras el commit.
    session.commit()

    signature = request.headers.get("X-Hub-Signature-256")
    if not adapter.verify_signature(
        webhook_secret=channel.webhook_secret,
        raw_body=raw,
        signature=signature,
    ):
        container.logger.warning(
            "bot.webhook.signature.rejected",
            "Firma del webhook inválida o ausente",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            has_signature=bool(signature),
        )
        raise TenantIsolationError(
            "Firma del webhook inválida o ausente",
            operation="bot.webhook.signature",
            context={"channel_id": str(channel.id)},
        )

    message = adapter.parse_inbound(payload=data, channel_id=channel.id)
    if message is None:
        container.logger.info(
            "bot.webhook.no_message",
            "Evento de WhatsApp sin mensaje entrante; se confirma 200",
            channel_id=str(channel.id),
        )
        return {"status": "ok"}

    with company_scope(
        CompanyContext(
            tenant_id=channel.tenant_id,
            channel_id=channel.id,
            channel_type=channel.channel_type,
            external_contact_id=message.external_contact_id,
        )
    ):
        message_id = message.message_id or str(uuid.uuid4())
        await run_in_threadpool(
            queue_service.enqueue_inbound,
            tenant_id=channel.tenant_id,
            channel_id=channel.id,
            external_contact_id=message.external_contact_id,
            message_id=message_id,
            content=message.text,
            direction=DIRECTION_INBOUND,
        )

    return {"status": "ok"}


@router.get("/queue/stats", response_model=QueueStatsRead)
def get_queue_stats(
    tenant_id: Annotated[uuid.UUID, Query()],
    _credential: Annotated[str, Depends(require_service_credential)],
    service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
) -> QueueStatsRead:
    """Estadísticas de la cola Redis D3 de un tenant (m2m, service credential).

    Diseño (Fase 5.1): endpoint solo-máquina autenticado con ``Authorization:
    Bearer <service_credential>`` (fail-closed) que combina la BD (fuente de
    verdad: enqueued/processed/failed) con Redis (cola viva:
    length/pending/consumer_lag) y el contador de DLQ del tenant. El ``tenant_id``
    es obligatorio (parámetro de consulta) porque no lleva ``X-Tenant-Id``.
    """
    return QueueStatsRead.from_stats(
        tenant_id=tenant_id,
        stats=service.queue_stats(tenant_id=tenant_id),
    )


@router.get("/context/{channel_id}", response_model=ContextBundleRead)
def get_channel_context(
    channel_id: uuid.UUID,
    _credential: Annotated[str, Depends(require_service_credential)],
    service: Annotated[ContextBundleService, Depends(get_context_bundle_service)],
) -> ContextBundleRead:
    """Context bundle m2m (solo-máquina) de la empresa para un canal.

    Diseño (plan §8.3): endpoint m2m autenticado con ``Authorization: Bearer
    <service_credential>``; NO lleva ``X-Tenant-Id`` porque el servicio resuelve
    canal → tenant en contexto de servicio (BYPASSRLS en PostgreSQL) y expone los
    secretos descifrados solo en memoria por request. 404 si el canal no existe o
    está deshabilitado.
    """
    return ContextBundleRead.from_bundle(service.get_bundle(channel_id=channel_id))


@router.get("/conversations", response_model=Page[ConversationRead])
def list_conversations(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    repository: Annotated[
        IBotConversationRepository, Depends(get_bot_conversation_repository)
    ],
    pagination: Annotated[Pagination, Depends()],
) -> Page[ConversationRead]:
    """Lista las conversaciones del bot del tenant activo (visor, Fase 7).

    Acotado al ``X-Tenant-Id`` del request: cada empresa solo ve sus propias
    conversaciones (aislamiento multi-tenant en el propio repositorio).
    """
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[ConversationRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    "/conversations/{conversation_id}/messages", response_model=list[MessageRead]
)
def list_conversation_messages(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    conversation_id: uuid.UUID,
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    conversations: Annotated[
        IBotConversationRepository, Depends(get_bot_conversation_repository)
    ],
    messages: Annotated[IBotMessageRepository, Depends(get_bot_message_repository)],
) -> list[MessageRead]:
    """Lista los mensajes de una conversación del tenant (Fase 7).

    La verificación de pertenencia (conversación existente y del tenant activo)
    es explícita: 404 si no existe o pertenece a otra empresa (fail-closed).
    """
    conversation = conversations.get(
        tenant_id=tenant_id, conversation_id=conversation_id
    )
    if conversation is None:
        raise NotFoundError(
            "Conversación no encontrada para el tenant activo",
            operation="bot.conversations.messages",
            context={
                "tenant_id": str(tenant_id),
                "conversation_id": str(conversation_id),
            },
        )
    rows = messages.list_by_conversation(
        tenant_id=tenant_id, conversation_id=conversation_id
    )
    return [MessageRead.model_validate(row) for row in rows]


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageEnqueueResult,
    status_code=status.HTTP_202_ACCEPTED,
)
def send_conversation_message(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    conversation_id: uuid.UUID,
    data: MessageCreate,
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    session: Annotated[Session, Depends(get_session)],
    conversations: Annotated[
        IBotConversationRepository, Depends(get_bot_conversation_repository)
    ],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
) -> MessageEnqueueResult:
    """Envía manualmente un mensaje de prueba a la cola D3 (Fase 7).

    Reutiliza la conversación existente: ``enqueue_inbound`` hace upsert por
    ``channel_id`` + ``external_contact_id`` manteniendo el mismo id de
    conversación. ``message_id`` es un ``uuid4`` nuevo por envío (idempotencia).
    Si la conversación no existe o pertenece a otro tenant → 404.
    """
    conversation = conversations.get(
        tenant_id=tenant_id, conversation_id=conversation_id
    )
    if conversation is None:
        raise NotFoundError(
            "Conversación no encontrada para el tenant activo",
            operation="bot.conversations.send",
            context={
                "tenant_id": str(tenant_id),
                "conversation_id": str(conversation_id),
            },
        )
    # La consulta anterior abrió una transacción de escritura (``BEGIN
    # IMMEDIATE`` en SQLite) sobre la sesión del request; se confirma para
    # liberar el bloqueo antes de que ``enqueue_inbound`` abra su propia sesión
    # del servicio de cola sobre el mismo archivo (evita "database is locked").
    session.commit()
    message_id = str(uuid.uuid4())
    accepted = queue_service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=conversation.channel_id,
        external_contact_id=conversation.external_contact_id,
        message_id=message_id,
        content=data.content,
        direction=DIRECTION_OUTBOUND,
    )
    return MessageEnqueueResult(
        message_id=message_id,
        conversation_id=conversation_id,
        direction=DIRECTION_OUTBOUND,
        queue_status=QUEUE_PENDING if accepted else "rejected",
        accepted=accepted,
    )


@router.get("/providers", response_model=list[BotProviderConfigRead])
def list_bot_providers(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    repository: Annotated[
        IBotProviderRepository, Depends(get_bot_provider_repository)
    ],
) -> list[BotProviderConfigRead]:
    """Lista los proveedores de IA configurados por la empresa (Fase 7).

    Nunca expone ``api_key`` ni ``api_key_ref`` (regla CLAUDE: secrets).
    """
    rows = repository.list(tenant_id=tenant_id)
    return [BotProviderConfigRead.model_validate(row) for row in rows]


@router.put("/providers", response_model=BotProviderConfigRead)
def upsert_bot_provider(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    data: BotProviderUpsert,
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    repository: Annotated[
        IBotProviderRepository, Depends(get_bot_provider_repository)
    ],
) -> BotProviderConfigRead:
    """Crea o actualiza un proveedor de IA de la empresa (Fase 7).

    Preserva la ``api_key_ref`` existente: las credenciales solo se gestionan vía
    el endpoint m2m de context bundle; este recurso es únicamente configuración
    (orden, modelo, temperature, prompt, enabled) sin secretos.
    """
    existing = repository.get_by_kind_order(
        tenant_id=tenant_id,
        provider_kind=data.provider_kind,
        order=data.order,
    )
    row = repository.upsert(
        tenant_id=tenant_id,
        provider_kind=data.provider_kind,
        order=data.order,
        enabled=data.enabled,
        model=data.model,
        temperature=(
            Decimal(data.temperature) if data.temperature is not None else None
        ),
        api_key_ref=existing.api_key_ref if existing is not None else "",
        prompt_base=data.prompt_base,
    )
    return BotProviderConfigRead.model_validate(row)


@router.delete(
    "/providers/{provider_kind}/{order}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_bot_provider(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    provider_kind: str,
    order: int,
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    repository: Annotated[
        IBotProviderRepository, Depends(get_bot_provider_repository)
    ],
) -> Response:
    """Soft-delete de un proveedor de IA de la empresa (nunca borrado físico)."""
    deleted = repository.soft_delete(
        tenant_id=tenant_id, provider_kind=provider_kind, order=order
    )
    if not deleted:
        raise NotFoundError(
            "Proveedor de IA no encontrado para el tenant activo",
            operation="bot.providers.delete",
            context={
                "tenant_id": str(tenant_id),
                "provider_kind": provider_kind,
                "order": order,
            },
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/queue/tenant-stats", response_model=QueueStatsRead)
def get_tenant_queue_stats(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
) -> QueueStatsRead:
    """Estadísticas de la cola D3 del tenant activo (monitor de cola, Fase 7).

    Ruta distinta de ``/queue/stats`` (m2m, service credential) para no romper el
    consumo de OmniBot_IA: este endpoint es para el panel de configuración y
    resuelve el tenant desde ``X-Tenant-Id`` sin exponer credenciales.
    """
    return QueueStatsRead.from_stats(
        tenant_id=tenant_id,
        stats=service.queue_stats(tenant_id=tenant_id),
    )


@router.get("/quota/usage", response_model=QuotaUsageResponse)
def get_bot_quota_usage(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    service: Annotated[IQuotaService, Depends(get_bot_quota_service)],
) -> QuotaUsageResponse:
    """Reporte de uso de tokens del bot en la ventana configurada (Fase 9b, L1).

    Agrega el consumo por proveedor IA del tenant activo y clasifica el estado
    (``ok``/``warning``/``exceeded``) contra ``BOT_QUOTA_DAILY_TOKENS``.
    """
    return service.report(tenant_id=tenant_id)


@router.get("/privacy/export", response_model=BotDataExportRead)
def export_bot_privacy_data(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    service: Annotated[IPrivacyService, Depends(get_bot_privacy_service)],
) -> BotDataExportRead:
    """Exporta los datos del bot del tenant activo (Fase 9a, M4 — portabilidad).

    Devuelve conversaciones y mensajes no eliminados para cumplir el derecho de
    portabilidad de la LFPDPPP (derechos ARCO).
    """
    return service.export(tenant_id=tenant_id)


@router.delete("/privacy/data", response_model=PrivacyDeletionResult)
def erase_bot_privacy_data(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    service: Annotated[IPrivacyService, Depends(get_bot_privacy_service)],
) -> PrivacyDeletionResult:
    """Elimina físicamente los datos del bot del tenant activo (Fase 9a, M4 — cancelación).

    Borrado permanente de conversaciones y mensajes del tenant (derecho de
    cancelación de la LFPDPPP); no depende del soft-delete.
    """
    return service.erase(tenant_id=tenant_id)


@router.post("/router/test", response_model=RouterTraceRead)
def test_router(
    _auth: Annotated[User, Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    conversation_service: Annotated[
        IConversationService | None, Depends(get_conversation_service)
    ],
    payload: RouterTestRequest,
) -> RouterTraceRead:
    """Motor de prueba del router del bot (Fase 4): qué rama decide y por qué.

    Escribe un mensaje crudo y obtiene la traza de la jerarquía real del bot
    (keyword → intent → general_chat) sin efectos: no persiste, no encola, no
    llama workflows ni al proveedor de IA (no contamina datos). Requiere el
    tenant activo (``X-Tenant-Id``); si el servicio de conversación no está
    disponible se responde 503.
    """
    if conversation_service is None:
        raise DependencyError(message="Servicio de conversación no disponible")
    return conversation_service.route_for_test(tenant_id=tenant_id, message=payload.message)
