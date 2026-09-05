"""Webhooks entrantes de los canales multired del bot (C-3 — Portales multired).

Contrato (plan §8.3 extendido a SMS/Instagram/Messenger/Webchat):
- ``GET /bot/channels/{instagram|messenger}/webhook``: handshake de Meta. El
  ``hub.verify_token`` NO es un valor local: se resuelve desde los canales
  configurados del tipo dado (``resolve_by_verify_token`` con
  ``channel_type``) comparándolo con el ``webhook_secret`` descifrado. Una vez
  resuelto el canal, la fábrica tenant-aware construye el adaptador concreto y
  se valida la estructura del handshake (``adapter.verify_webhook``). Fail-closed:
  sin coincidencia o estructura inválida → 403; si es válida se devuelve el
  challenge como texto plano (Meta espera ese eco exacto).
- ``POST /bot/channels/{instagram|messenger}/webhook``: mensajes entrantes de la
  Graph API de Meta. Se extrae ``entry[0].id`` (equivale al ``external_id`` del
  canal) → se resuelve canal → tenant, se verifica la firma
  ``X-Hub-Signature-256`` con el ``webhook_secret`` del canal, se normaliza el
  mensaje, se fija el contexto de empresa (``company_scope``) y se encola en la
  cola D3 (mismo punto único de entrada que WhatsApp).
- ``POST /bot/channels/sms/webhook``: mensajes entrantes de Twilio (SMS). No hay
  handshake ``GET``. El ruteo usa el campo ``To`` contra ``phone_number`` del
  canal (``resolve_by_phone_number``) y la autenticación usa el header
  ``X-Twilio-Signature`` (HMAC-SHA1 de la URL + parámetros del formulario
  ordenados, clave = ``access_token``/auth_token del canal).
- ``POST /bot/channels/webchat/webhook``: mensajes del widget embebido del portal
  (canal *pull*). El payload trae el ``channel_id`` (UUID) del canal y, si el
  canal tiene ``access_token`` (la fábrica así lo exige), se valida el header
  ``X-Widget-Key`` en tiempo constante (fail-closed).

Todos los eventos sin mensaje o de un canal desconocido se confirman con ``200``
(los proveedores reintentan los no-200). Los cuerpos inválidos (JSON o UTF-8) se
rechazan con ``422``; las firmas ausentes/incorrectas con ``403`` (aislamiento de
tenant, fail-closed).
"""

from __future__ import annotations

import hmac
import json
import urllib.parse
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import (
    get_bot_queue_service,
    get_channel_sender_factory,
    get_container,
    get_session,
    get_tenant_channel_repository,
)
from app.bot.channels.meta import MetaMessagingChannelAdapter
from app.bot.company_context import CompanyContext, company_scope
from app.bot.interfaces import IChannelSenderFactory, InboundMessage
from app.bot.queue.service import DIRECTION_INBOUND, BotQueueService
from app.core.di import Container
from app.core.errors import InputValidationError, TenantIsolationError
from app.models.tenant_config import TenantChannel
from app.repositories.interfaces import ITenantChannelRepository

router = APIRouter(prefix="/bot/channels", tags=["bot"])


# ---------------------------------------------------------------------------
# Helpers compartidos (DRY: mismo flujo de persistencia + encolado que WhatsApp)
# ---------------------------------------------------------------------------


async def _enqueue_inbound(
    *,
    queue_service: BotQueueService,
    channel: TenantChannel,
    message: InboundMessage,
) -> None:
    """Persiste y encola un mensaje entrante en la cola D3 (punto único).

    Replica el flujo del webhook de WhatsApp (Fase 5.1): fija el contexto de
    empresa con ``company_scope`` y delega en ``BotQueueService.enqueue_inbound``
    (at-least-once, idempotente por ``message_id``) vía threadpool.
    """
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


def _verify_meta_webhook(
    *,
    channel_type: str,
    repository: ITenantChannelRepository,
    factory: IChannelSenderFactory,
    container: Container,
    hub_mode: str | None,
    hub_verify_token: str | None,
    hub_challenge: str | None,
) -> PlainTextResponse:
    """Handshake ``GET`` compartido de los webhooks de Meta (IG/Messenger).

    Diseño: el ``verify_token`` se resuelve desde los canales del tipo dado,
    nunca localmente. Si el token no coincide con ningún canal habilitado se
    responde 403 (fail-closed); si el adaptador no se puede construir (fábrica
    tenant-aware, p. ej. sin credenciales) también 403; si la estructura del
    handshake es inválida, 403. En caso contrario se devuelve el challenge como
    ``text/plain`` (Meta exige ese eco exacto).
    """
    channel = repository.resolve_by_verify_token(
        verify_token=hub_verify_token or "",
        channel_type=channel_type,
    )
    if channel is None:
        container.logger.warning(
            "bot.webhook.verify.token_rejected",
            "verify_token no corresponde a ningún canal habilitado",
            channel_type=channel_type,
            has_mode=bool(hub_mode),
            has_challenge=bool(hub_challenge),
        )
        raise TenantIsolationError(
            "verify_token no corresponde a ningún canal habilitado",
            operation="bot.webhook.verify",
            context={"channel_type": channel_type, "has_mode": bool(hub_mode)},
        )

    adapter = factory.resolve(channel_id=channel.id)
    if adapter is None:
        container.logger.warning(
            "bot.webhook.verify.adapter_unresolved",
            "No se pudo construir el adaptador para el canal del handshake",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            channel_type=channel_type,
        )
        raise TenantIsolationError(
            "No se pudo construir el adaptador para el canal del handshake",
            operation="bot.webhook.verify",
            context={"channel_id": str(channel.id), "channel_type": channel_type},
        )

    challenge = adapter.verify_webhook(
        mode=hub_mode,
        verify_token=hub_verify_token,
        challenge=hub_challenge,
    )
    if challenge is None:
        container.logger.warning(
            "bot.webhook.verify.handshake_rejected",
            "Handshake del webhook de Meta inválido",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            channel_type=channel_type,
            mode=hub_mode,
        )
        raise TenantIsolationError(
            "Handshake del webhook de Meta inválido",
            operation="bot.webhook.verify",
            context={"channel_id": str(channel.id), "channel_type": channel_type, "mode": hub_mode},
        )

    container.logger.info(
        "bot.webhook.verified",
        "Webhook de Meta verificado",
        channel_id=str(channel.id),
        tenant_id=str(channel.tenant_id),
        channel_type=channel_type,
    )
    return PlainTextResponse(challenge)


async def _receive_meta_webhook(
    *,
    channel_type: str,
    request: Request,
    repository: ITenantChannelRepository,
    factory: IChannelSenderFactory,
    queue_service: BotQueueService,
    container: Container,
    session: Session,
) -> dict[str, str]:
    """Flujo ``POST`` compartido de los webhooks de Meta (IG/Messenger).

    Lee el cuerpo crudo (necesario para verificar la firma) → extrae
    ``entry[0].id`` → resuelve canal → tenant por ``external_id`` → cierra la
    transacción de lectura → construye el adaptador con la fábrica → verifica la
    firma ``X-Hub-Signature-256`` con el ``webhook_secret`` del canal → normaliza
    el mensaje → fija el contexto de empresa → persiste y encola. Todo evento sin
    mensaje o de un canal desconocido se confirma con ``200``.
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

    entry_id = MetaMessagingChannelAdapter.extract_entry_id(data)
    channel = (
        repository.resolve_by_external_id(channel_type=channel_type, external_id=entry_id)
        if entry_id
        else None
    )
    if channel is None:
        container.logger.info(
            "bot.webhook.channel_unknown",
            "Evento de Meta sin canal resoluble; se confirma 200",
            channel_type=channel_type,
            entry_id=entry_id,
        )
        return {"status": "ok"}

    # Cierra la transacción de lectura del request (mismo motivo que WhatsApp:
    # liberar el lock RESERVED de SQLite antes de que ``enqueue_inbound`` abra su
    # propia ``session_scope()``; en PostgreSQL es un cierre temprano inofensivo).
    session.commit()

    adapter = factory.resolve(channel_id=channel.id)
    if adapter is None:
        container.logger.warning(
            "bot.webhook.adapter_unresolved",
            "Canal sin adaptador construible; se confirma 200 sin despachar",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            channel_type=channel_type,
        )
        return {"status": "ok"}

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
            channel_type=channel_type,
            has_signature=bool(signature),
        )
        raise TenantIsolationError(
            "Firma del webhook inválida o ausente",
            operation="bot.webhook.signature",
            context={"channel_id": str(channel.id), "channel_type": channel_type},
        )

    message = adapter.parse_inbound(payload=data, channel_id=channel.id)
    if message is None:
        container.logger.info(
            "bot.webhook.no_message",
            "Evento de Meta sin mensaje entrante; se confirma 200",
            channel_id=str(channel.id),
            channel_type=channel_type,
        )
        return {"status": "ok"}

    await _enqueue_inbound(
        queue_service=queue_service,
        channel=channel,
        message=message,
    )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# GET /bot/channels/{instagram|messenger}/webhook — handshake de Meta
# ---------------------------------------------------------------------------


@router.get("/instagram/webhook")
def verify_instagram_webhook(
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    container: Annotated[Container, Depends(get_container)],
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    """Handshake ``GET`` del webhook de Instagram (Meta)."""
    return _verify_meta_webhook(
        channel_type="instagram",
        repository=repository,
        factory=factory,
        container=container,
        hub_mode=hub_mode,
        hub_verify_token=hub_verify_token,
        hub_challenge=hub_challenge,
    )


@router.get("/messenger/webhook")
def verify_messenger_webhook(
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    container: Annotated[Container, Depends(get_container)],
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    """Handshake ``GET`` del webhook de Messenger (Meta)."""
    return _verify_meta_webhook(
        channel_type="messenger",
        repository=repository,
        factory=factory,
        container=container,
        hub_mode=hub_mode,
        hub_verify_token=hub_verify_token,
        hub_challenge=hub_challenge,
    )


# ---------------------------------------------------------------------------
# POST /bot/channels/{instagram|messenger}/webhook — mensajes entrantes de Meta
# ---------------------------------------------------------------------------


@router.post("/instagram/webhook")
async def receive_instagram_webhook(
    request: Request,
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
    container: Annotated[Container, Depends(get_container)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Recibe el webhook ``POST`` de Instagram (mensajes entrantes)."""
    return await _receive_meta_webhook(
        channel_type="instagram",
        request=request,
        repository=repository,
        factory=factory,
        queue_service=queue_service,
        container=container,
        session=session,
    )


@router.post("/messenger/webhook")
async def receive_messenger_webhook(
    request: Request,
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
    container: Annotated[Container, Depends(get_container)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Recibe el webhook ``POST`` de Messenger (mensajes entrantes)."""
    return await _receive_meta_webhook(
        channel_type="messenger",
        request=request,
        repository=repository,
        factory=factory,
        queue_service=queue_service,
        container=container,
        session=session,
    )


# ---------------------------------------------------------------------------
# POST /bot/channels/sms/webhook — mensajes entrantes de Twilio (sin GET)
# ---------------------------------------------------------------------------


@router.post("/sms/webhook")
async def receive_sms_webhook(
    request: Request,
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
    container: Annotated[Container, Depends(get_container)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Recibe el webhook ``POST`` de Twilio (SMS entrantes, form-urlencoded).

    Twilio no tiene handshake ``GET`` ni un token estático por canal: el ruteo
    entrante usa el campo ``To`` contra ``phone_number`` del canal de tipo
    ``sms`` y la autenticación verifica el header ``X-Twilio-Signature``
    (HMAC-SHA1 de la URL completa + parámetros del formulario ordenados, clave =
    ``auth_token`` del canal). Fail-closed: canal desconocido o firma inválida.
    """
    raw = await request.body()
    try:
        parsed = urllib.parse.parse_qs(
            raw.decode("utf-8"),
            keep_blank_values=True,
        )
    except UnicodeDecodeError:
        raise InputValidationError(
            "Cuerpo del webhook no es UTF-8 válido",
            operation="bot.webhook.inbound",
        ) from None
    form_params: dict[str, str] = {
        key: values[0] for key, values in parsed.items() if values
    }

    to_number = form_params.get("To") or ""
    channel = (
        repository.resolve_by_phone_number(channel_type="sms", phone_number=to_number)
        if to_number
        else None
    )
    if channel is None:
        container.logger.info(
            "bot.webhook.channel_unknown",
            "SMS sin canal resoluble; se confirma 200",
            to_number=to_number,
        )
        return {"status": "ok"}

    session.commit()

    adapter = factory.resolve(channel_id=channel.id)
    if adapter is None:
        container.logger.warning(
            "bot.webhook.adapter_unresolved",
            "Canal SMS sin adaptador construible; se confirma 200 sin despachar",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
        )
        return {"status": "ok"}

    signature = request.headers.get("X-Twilio-Signature")
    if not adapter.verify_signature(
        auth_token=channel.access_token,
        url=str(request.url),
        form_params=form_params,
        signature=signature,
    ):
        container.logger.warning(
            "bot.webhook.signature.rejected",
            "Firma del webhook de Twilio inválida o ausente",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
            has_signature=bool(signature),
        )
        raise TenantIsolationError(
            "Firma del webhook inválida o ausente",
            operation="bot.webhook.signature",
            context={"channel_id": str(channel.id)},
        )

    message = adapter.parse_inbound(payload=form_params, channel_id=channel.id)
    if message is None:
        container.logger.info(
            "bot.webhook.no_message",
            "SMS sin mensaje entrante; se confirma 200",
            channel_id=str(channel.id),
        )
        return {"status": "ok"}

    await _enqueue_inbound(
        queue_service=queue_service,
        channel=channel,
        message=message,
    )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /bot/channels/webchat/webhook — mensajes del widget del portal
# ---------------------------------------------------------------------------


@router.post("/webchat/webhook")
async def receive_webchat_webhook(
    request: Request,
    repository: Annotated[
        ITenantChannelRepository, Depends(get_tenant_channel_repository)
    ],
    factory: Annotated[IChannelSenderFactory, Depends(get_channel_sender_factory)],
    queue_service: Annotated[BotQueueService, Depends(get_bot_queue_service)],
    container: Annotated[Container, Depends(get_container)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Recibe el webhook ``POST`` del widget de webchat del portal.

    El payload trae el ``channel_id`` (UUID, snake_case o camelCase) que se
    resuelve por ``resolve_by_channel_id``. El canal de webchat solo resuelve en
    la fábrica si tiene ``access_token`` (clave del widget); cuando existe se
    valida el header ``X-Widget-Key`` en tiempo constante (fail-closed). Sin
    ``contact_id`` se confirma ``200`` sin despachar (canal pull: la respuesta
    se persiste y el widget la descarga del historial).
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

    raw_channel_id = data.get("channel_id") or data.get("channelId")
    channel_id: uuid.UUID | None = None
    try:
        channel_id = uuid.UUID(str(raw_channel_id))
    except (TypeError, ValueError, AttributeError):
        channel_id = None

    channel = (
        repository.resolve_by_channel_id(channel_id=channel_id)
        if channel_id is not None
        else None
    )
    if channel is None:
        container.logger.info(
            "bot.webhook.channel_unknown",
            "Evento de webchat sin canal resoluble; se confirma 200",
            channel_id_value=str(raw_channel_id),
        )
        return {"status": "ok"}

    session.commit()

    adapter = factory.resolve(channel_id=channel.id)
    if adapter is None:
        container.logger.warning(
            "bot.webhook.adapter_unresolved",
            "Canal de webchat sin adaptador construible; se confirma 200 sin despachar",
            channel_id=str(channel.id),
            tenant_id=str(channel.tenant_id),
        )
        return {"status": "ok"}

    # Clave del widget: obligatoria cuando el canal tiene ``access_token`` (la
    # fábrica lo exige para resolver), comparada en tiempo constante.
    if channel.access_token:
        widget_key = request.headers.get("X-Widget-Key") or ""
        if not hmac.compare_digest(channel.access_token, widget_key):
            container.logger.warning(
                "bot.webhook.signature.rejected",
                "Clave del widget de webchat inválida o ausente",
                channel_id=str(channel.id),
                tenant_id=str(channel.tenant_id),
                has_widget_key=bool(widget_key),
            )
            raise TenantIsolationError(
                "Clave del widget de webchat inválida o ausente",
                operation="bot.webhook.signature",
                context={"channel_id": str(channel.id)},
            )

    message = adapter.parse_inbound(payload=data, channel_id=channel.id)
    if message is None:
        container.logger.info(
            "bot.webhook.no_message",
            "Evento de webchat sin mensaje entrante; se confirma 200",
            channel_id=str(channel.id),
        )
        return {"status": "ok"}

    await _enqueue_inbound(
        queue_service=queue_service,
        channel=channel,
        message=message,
    )
    return {"status": "ok"}
