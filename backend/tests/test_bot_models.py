"""Pruebas de los modelos de ejecución del bot OmniBotIA (Fase 3).

Cubren: construcción de las cuatro entidades, valores por defecto, restricciones
de unicidad y que los atributos transitorios (``api_key``/``attempts``) NUNCA se
persisten como columnas (regla CLAUDE: secretos solo en memoria).
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.bot.models import BotCompanyProvider, BotConversation, BotMessage, BotQueueMeta


def test_bot_company_provider_defaults(db_session: Session) -> None:
    """Los defaults se materializan al insertar (flush), no en la construcción."""
    provider = BotCompanyProvider(tenant_id=uuid.uuid4(), provider_kind="llm")
    db_session.add(provider)
    db_session.flush()

    assert provider.order == 0
    assert provider.enabled is True
    assert provider.api_key_ref == ""
    assert provider.prompt_base == ""
    assert provider.model is None
    assert provider.temperature is None


def test_bot_company_provider_api_key_is_transient() -> None:
    """La api_key descifrada es un atributo transitorio, NO una columna."""
    assert "api_key" not in BotCompanyProvider.__table__.columns
    assert "api_key_ref" in BotCompanyProvider.__table__.columns

    provider = BotCompanyProvider(tenant_id=uuid.uuid4(), provider_kind="llm")
    provider.api_key = "clave-secreta-en-memoria"
    assert provider.api_key == "clave-secreta-en-memoria"


def test_bot_company_provider_unique_constraint() -> None:
    names = {constraint.name for constraint in BotCompanyProvider.__table__.constraints}
    assert "uq_bot_provider_kind_order" in names


def test_bot_conversation_defaults(db_session: Session) -> None:
    conversation = BotConversation(
        tenant_id=uuid.uuid4(),
        channel_id=uuid.uuid4(),
        external_contact_id="+5215500000000",
    )
    db_session.add(conversation)
    db_session.flush()

    assert conversation.state == "new"
    assert conversation.last_message_at is None


def test_bot_conversation_columns_and_unique_constraint() -> None:
    columns = BotConversation.__table__.columns
    assert "tenant_id" in columns
    assert "channel_id" in columns
    assert "external_contact_id" in columns
    assert "state" in columns
    assert "last_message_at" in columns

    names = {constraint.name for constraint in BotConversation.__table__.constraints}
    assert "uq_bot_conversation_channel_contact" in names


def test_bot_message_defaults(db_session: Session) -> None:
    message = BotMessage(
        tenant_id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        direction="inbound",
    )
    db_session.add(message)
    db_session.flush()

    assert message.content == ""
    assert message.tokens_used == 0
    assert message.queue_status == "pending"
    assert message.provider_used is None
    assert message.message_id is None


def test_bot_message_attempts_is_transient() -> None:
    """Los intentos de procesamiento (PEL de D3) no se persisten como columna."""
    assert "attempts" not in BotMessage.__table__.columns

    message = BotMessage(
        tenant_id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        direction="outbound",
    )
    message.attempts = 3
    assert message.attempts == 3


def test_bot_message_unique_constraint() -> None:
    names = {constraint.name for constraint in BotMessage.__table__.constraints}
    assert "uq_bot_messages_message_id" in names


def test_bot_queue_meta_defaults_and_unique_constraint(db_session: Session) -> None:
    meta = BotQueueMeta(tenant_id=uuid.uuid4(), stream="bot:queue:dev-tenant")
    db_session.add(meta)
    db_session.flush()

    assert meta.dlq_count == 0
    assert meta.last_processed_id is None

    names = {constraint.name for constraint in BotQueueMeta.__table__.constraints}
    assert "uq_bot_queue_meta_stream" in names
