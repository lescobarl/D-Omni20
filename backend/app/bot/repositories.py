"""Implementación SQLAlchemy de los repositorios del bot (inyectados vía DI).

Sigue el precedente de :mod:`app.repositories.workflow_repositories`: cada
repositorio recibe la ``Session`` en el constructor y filtra SIEMPRE por
``tenant_id`` y ``deleted.is_(False)`` (defensa en profundidad).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.bot.models import BotCompanyProvider, BotConversation, BotMessage, BotQueueMeta
from app.bot.repository_interfaces import (
    BotActiveConversation,
    BotUsageAggregate,
    IBotConversationRepository,
    IBotMessageRepository,
    IBotProviderRepository,
    IBotQueueMetaRepository,
)

# Direcciones de mensaje (espejo de ``BotMessage.direction``). Se definen aquí
# para que el repositorio sea autocontenido y evitar un import circular con
# ``app.bot.queue.service`` (que ya importa de este módulo).
_DIRECTION_INBOUND = "inbound"


class SqlAlchemyBotProviderRepository(IBotProviderRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        return (BotCompanyProvider.tenant_id == tenant_id) & (
            BotCompanyProvider.deleted.is_(False)
        )

    def get_by_kind_order(
        self, *, tenant_id: uuid.UUID, provider_kind: str, order: int
    ) -> BotCompanyProvider | None:
        statement = (
            select(BotCompanyProvider)
            .where(
                BotCompanyProvider.provider_kind == provider_kind,
                BotCompanyProvider.order == order,
                self._active_scope(tenant_id),
            )
            .order_by(BotCompanyProvider.created_at.asc())
        )
        return self._session.scalars(statement).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        provider_kind: str,
        order: int,
        enabled: bool,
        model: str | None,
        temperature: Decimal | None,
        api_key_ref: str,
        prompt_base: str,
    ) -> BotCompanyProvider:
        row = self.get_by_kind_order(
            tenant_id=tenant_id, provider_kind=provider_kind, order=order
        )
        if row is None:
            row = BotCompanyProvider(
                tenant_id=tenant_id,
                provider_kind=provider_kind,
                order=order,
                enabled=enabled,
                model=model,
                temperature=temperature,
                api_key_ref=api_key_ref,
                prompt_base=prompt_base,
            )
            self._session.add(row)
        else:
            row.enabled = enabled
            row.model = model
            row.temperature = temperature
            row.api_key_ref = api_key_ref
            row.prompt_base = prompt_base
        self._session.flush()
        return row

    def list(self, *, tenant_id: uuid.UUID) -> list[BotCompanyProvider]:
        statement = (
            select(BotCompanyProvider)
            .where(self._active_scope(tenant_id))
            .order_by(BotCompanyProvider.provider_kind.asc(), BotCompanyProvider.order.asc())
        )
        return list(self._session.scalars(statement).all())

    def soft_delete(
        self, *, tenant_id: uuid.UUID, provider_kind: str, order: int
    ) -> bool:
        row = self.get_by_kind_order(
            tenant_id=tenant_id, provider_kind=provider_kind, order=order
        )
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyBotConversationRepository(IBotConversationRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        return (BotConversation.tenant_id == tenant_id) & (
            BotConversation.deleted.is_(False)
        )

    def get(self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> BotConversation | None:
        statement = select(BotConversation).where(
            BotConversation.id == conversation_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def get_by_channel_contact(
        self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID, external_contact_id: str
    ) -> BotConversation | None:
        statement = (
            select(BotConversation)
            .where(
                BotConversation.channel_id == channel_id,
                BotConversation.external_contact_id == external_contact_id,
                self._active_scope(tenant_id),
            )
            .order_by(BotConversation.created_at.asc())
        )
        return self._session.scalars(statement).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_id: uuid.UUID,
        external_contact_id: str,
        state: str,
        last_message_at: datetime | None,
    ) -> BotConversation:
        row = self.get_by_channel_contact(
            tenant_id=tenant_id,
            channel_id=channel_id,
            external_contact_id=external_contact_id,
        )
        if row is None:
            row = BotConversation(
                tenant_id=tenant_id,
                channel_id=channel_id,
                external_contact_id=external_contact_id,
                state=state,
                last_message_at=last_message_at,
            )
            self._session.add(row)
        else:
            row.state = state
            row.last_message_at = last_message_at
        self._session.flush()
        return row

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotConversation], int]:
        base = select(BotConversation).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotConversation.last_message_at.desc().nullslast())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_active(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotActiveConversation], int]:
        """Vista de negocio paginada de conversaciones activas (Monitor, Fase 7).

        Agrega por conversación el último mensaje, el contador de mensajes y
        los no leídos (entrantes desde el último saliente). Una única consulta
        de mensajes por ``conversation_id.in_(ids)`` evita el N+1.
        """
        base = select(BotConversation).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotConversation.last_message_at.desc().nullslast())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        conversations = list(self._session.scalars(statement).all())
        if not conversations:
            return [], total

        conversation_ids = [row.id for row in conversations]
        messages = list(
            self._session.scalars(
                select(BotMessage)
                .where(
                    BotMessage.tenant_id == tenant_id,
                    BotMessage.conversation_id.in_(conversation_ids),
                    BotMessage.deleted.is_(False),
                )
                .order_by(BotMessage.created_at.asc())
            ).all()
        )

        by_conversation: dict[uuid.UUID, list[BotMessage]] = {}
        for message in messages:
            by_conversation.setdefault(message.conversation_id, []).append(message)

        items: list[BotActiveConversation] = []
        for conversation in conversations:
            conversation_messages = by_conversation.get(conversation.id, [])
            last = conversation_messages[-1] if conversation_messages else None
            unread = 0
            for message in conversation_messages:
                if message.direction == _DIRECTION_INBOUND:
                    unread += 1
                else:
                    unread = 0
            items.append(
                BotActiveConversation(
                    id=conversation.id,
                    tenant_id=conversation.tenant_id,
                    channel_id=conversation.channel_id,
                    external_contact_id=conversation.external_contact_id,
                    state=conversation.state,
                    is_active=bool(conversation_messages),
                    message_count=len(conversation_messages),
                    unread_count=unread,
                    last_message_content=last.content if last else None,
                    last_message_direction=last.direction if last else None,
                    last_message_at=last.created_at if last else None,
                    updated_at=conversation.updated_at,
                )
            )
        return items, total

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotConversation]:
        """Todas las conversaciones activas del tenant (exportación M4)."""
        statement = (
            select(BotConversation)
            .where(self._active_scope(tenant_id))
            .order_by(BotConversation.last_message_at.desc().nullslast())
        )
        return list(self._session.scalars(statement).all())

    def delete_all(self, *, tenant_id: uuid.UUID) -> int:
        """Borrado físico completo (M4) — no filtra ``deleted`` (erasure total)."""
        result = self._session.execute(
            delete(BotConversation).where(BotConversation.tenant_id == tenant_id)
        )
        self._session.flush()
        return result.rowcount or 0

    def delete_older_than(self, *, tenant_id: uuid.UUID, before: datetime) -> int:
        """Borra físicamente conversaciones inactivas anteriores a ``before`` (retención M4)."""
        idle_before = func.coalesce(
            BotConversation.last_message_at, BotConversation.created_at
        ) < before
        result = self._session.execute(
            delete(BotConversation).where(
                BotConversation.tenant_id == tenant_id, idle_before
            )
        )
        self._session.flush()
        return result.rowcount or 0


class SqlAlchemyBotMessageRepository(IBotMessageRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        return (BotMessage.tenant_id == tenant_id) & (BotMessage.deleted.is_(False))

    def get_by_message_id(self, *, tenant_id: uuid.UUID, message_id: str) -> BotMessage | None:
        statement = select(BotMessage).where(
            BotMessage.message_id == message_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        direction: str,
        content: str,
        provider_used: str | None,
        tokens_used: int,
        message_id: str | None,
        queue_status: str,
        created_at: datetime | None = None,
    ) -> BotMessage:
        row = BotMessage(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            direction=direction,
            content=content,
            provider_used=provider_used,
            tokens_used=tokens_used,
            message_id=message_id,
            queue_status=queue_status,
        )
        if created_at is not None:
            row.created_at = created_at
        self._session.add(row)
        self._session.flush()
        return row

    def list_by_conversation(
        self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> list[BotMessage]:
        statement = (
            select(BotMessage)
            .where(
                BotMessage.conversation_id == conversation_id,
                self._active_scope(tenant_id),
            )
            .order_by(BotMessage.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotMessage], int]:
        base = select(BotMessage).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotMessage.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def update_queue_status(
        self, *, tenant_id: uuid.UUID, message_id: str, queue_status: str
    ) -> BotMessage | None:
        row = self.get_by_message_id(tenant_id=tenant_id, message_id=message_id)
        if row is None:
            return None
        row.queue_status = queue_status
        self._session.flush()
        return row

    def list_by_status(
        self, *, tenant_id: uuid.UUID, queue_status: str, page: int, page_size: int
    ) -> tuple[list[BotMessage], int]:
        base = select(BotMessage).where(
            BotMessage.queue_status == queue_status, self._active_scope(tenant_id)
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotMessage.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def count_by_status(self, *, tenant_id: uuid.UUID) -> dict[str, int]:
        statement = (
            select(BotMessage.queue_status, func.count())
            .where(self._active_scope(tenant_id))
            .group_by(BotMessage.queue_status)
        )
        return {
            status: count for status, count in self._session.execute(statement).all()
        }

    def aggregate_usage(
        self, *, tenant_id: uuid.UUID, since: datetime
    ) -> list[BotUsageAggregate]:
        """Consumo ``SUM(tokens_used)`` y recuento por proveedor en la ventana (L1)."""
        statement = (
            select(
                BotMessage.provider_used,
                func.sum(BotMessage.tokens_used),
                func.count(),
            )
            .where(self._active_scope(tenant_id), BotMessage.created_at >= since)
            .group_by(BotMessage.provider_used)
        )
        return [
            BotUsageAggregate(
                provider_used=provider_used,
                tokens_used=int(tokens_used or 0),
                message_count=count,
            )
            for provider_used, tokens_used, count in self._session.execute(statement).all()
        ]

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotMessage]:
        """Todos los mensajes activos del tenant (exportación M4)."""
        statement = (
            select(BotMessage)
            .where(self._active_scope(tenant_id))
            .order_by(BotMessage.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def delete_all(self, *, tenant_id: uuid.UUID) -> int:
        """Borrado físico completo (M4) — no filtra ``deleted`` (erasure total)."""
        result = self._session.execute(
            delete(BotMessage).where(BotMessage.tenant_id == tenant_id)
        )
        self._session.flush()
        return result.rowcount or 0

    def delete_older_than(self, *, tenant_id: uuid.UUID, before: datetime) -> int:
        """Borra físicamente mensajes anteriores a ``before`` (retención M4)."""
        result = self._session.execute(
            delete(BotMessage).where(
                BotMessage.tenant_id == tenant_id,
                BotMessage.created_at < before,
            )
        )
        self._session.flush()
        return result.rowcount or 0


class SqlAlchemyBotQueueMetaRepository(IBotQueueMetaRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID, stream: str) -> Any:
        return (
            (BotQueueMeta.tenant_id == tenant_id)
            & (BotQueueMeta.stream == stream)
            & (BotQueueMeta.deleted.is_(False))
        )

    def get(self, *, tenant_id: uuid.UUID, stream: str) -> BotQueueMeta | None:
        statement = select(BotQueueMeta).where(self._active_scope(tenant_id, stream))
        return self._session.scalars(statement).first()

    def upsert(self, *, tenant_id: uuid.UUID, stream: str) -> BotQueueMeta:
        row = self.get(tenant_id=tenant_id, stream=stream)
        if row is None:
            row = BotQueueMeta(tenant_id=tenant_id, stream=stream)
            self._session.add(row)
            self._session.flush()
        return row

    def increment_dlq(self, *, tenant_id: uuid.UUID, stream: str) -> None:
        row = self.get(tenant_id=tenant_id, stream=stream)
        if row is None:
            row = BotQueueMeta(tenant_id=tenant_id, stream=stream, dlq_count=0)
            self._session.add(row)
        row.dlq_count += 1
        self._session.flush()

    def list_streams(self) -> list[str]:
        statement = (
            select(BotQueueMeta.stream)
            .where(BotQueueMeta.deleted.is_(False))
            .order_by(BotQueueMeta.stream.asc())
        )
        return list(self._session.scalars(statement).all())
