"""Pruebas de la cola D3 (Fase 5.1): servicio de cola y worker pool.

Cubre :class:`BotQueueService` (persistencia en BD + enqueue Redis Streams) y
:class:`BotWorkerPool` (procesamiento, reintentos y DLQ) usando una cola Redis
falsa (:class:`FakeQueue`) y los repositorios SQLAlchemy reales sobre el SQLite
compartido de los tests (hermético, sin Redis real).
"""

from __future__ import annotations

import dataclasses
import uuid
from datetime import timedelta
from typing import Any

from app.bot.interfaces import (
    BotResponse,
    IChannelAdapter,
    IChannelSenderFactory,
    IConversationService,
    InboundMessage,
    RouterStep,
    RouterTrace,
)
from app.bot.models import BotConversation, BotMessage
from app.bot.queue.interfaces import IQueue, StreamMessage
from app.bot.queue.service import (
    QUEUE_FAILED,
    QUEUE_PENDING,
    QUEUE_SENT,
    BotQueueService,
)
from app.bot.queue.worker import BotWorkerPool
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.core.di import Container
from app.core.logging import ILogger
from app.models.base import utcnow
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository


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


class FakeQueue(IQueue):
    """Implementación en memoria del puerto :class:`IQueue` (hermética)."""

    def __init__(self) -> None:
        self.entries: dict[str, list[tuple[str, dict[str, str]]]] = {}
        self.dlq: dict[str, list[tuple[str, dict[str, str]]]] = {}
        self.acked: set[tuple[str, str, str]] = set()
        self.delivered: set[tuple[str, str, str]] = set()
        self.enqueue_should_fail = False
        self.closed = False
        self._seq = 0

    def _next_id(self) -> str:
        self._seq += 1
        return f"seq-{self._seq}"

    def _to_message(self, stream: str, entry_id: str, fields: dict[str, str]) -> StreamMessage:
        try:
            attempts = int(fields.get("attempts", "0") or "0")
        except (TypeError, ValueError):
            attempts = 0
        return StreamMessage(stream=stream, message_id=entry_id, fields=dict(fields), attempts=attempts)

    def enqueue(self, stream: str, fields: dict[str, str]) -> str | None:
        if self.enqueue_should_fail:
            return None
        entry_id = self._next_id()
        self.entries.setdefault(stream, []).append((entry_id, dict(fields)))
        return entry_id

    def read_group(self, stream: str, group: str, consumer: str, count: int) -> list[StreamMessage]:
        result: list[StreamMessage] = []
        for entry_id, fields in self.entries.get(stream, []):
            if (stream, group, entry_id) not in self.acked and (
                stream,
                group,
                entry_id,
            ) not in self.delivered:
                self.delivered.add((stream, group, entry_id))
                result.append(self._to_message(stream, entry_id, fields))
                if len(result) >= count:
                    break
        return result

    def ack(self, stream: str, group: str, message_id: str) -> bool:
        key = (stream, group, message_id)
        if key in self.delivered:
            self.delivered.discard(key)
            self.acked.add(key)
            return True
        return False

    def claim(
        self, stream: str, group: str, consumer: str, min_idle_ms: int, count: int
    ) -> list[StreamMessage]:
        result: list[StreamMessage] = []
        for entry_id, fields in self.entries.get(stream, []):
            key = (stream, group, entry_id)
            if key in self.delivered and key not in self.acked:
                result.append(self._to_message(stream, entry_id, fields))
                if len(result) >= count:
                    break
        return result

    def xlen(self, stream: str) -> int:
        return len(self.entries.get(stream, []))

    def pending(self, stream: str, group: str) -> int:
        return sum(
            1
            for entry_id, _ in self.entries.get(stream, [])
            if (stream, group, entry_id) in self.delivered and (stream, group, entry_id) not in self.acked
        )

    def consumer_lag(self, stream: str, group: str) -> int | None:
        return 0

    def to_dlq(self, stream: str, fields: dict[str, str], reason: str) -> str | None:
        payload = dict(fields)
        payload["original_stream"] = stream
        payload["dlq_reason"] = reason
        dlq_stream = f"bot:dlq:{stream.rsplit(':', 1)[-1]}"
        entry_id = self._next_id()
        self.dlq.setdefault(dlq_stream, []).append((entry_id, payload))
        return entry_id

    def close(self) -> None:
        self.closed = True


class FakeProcessor(IConversationService):
    """Procesador falso: registra llamadas y opcionalmente lanza un error."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[InboundMessage, IChannelAdapter]] = []

    def handle_inbound(self, *, message: InboundMessage, adapter: IChannelAdapter) -> BotResponse:
        self.calls.append((message, adapter))
        if self.error is not None:
            raise self.error
        return BotResponse(content="ok", provider_kind="stub")

    def route_for_test(self, *, tenant_id: uuid.UUID, message: str) -> RouterTrace:
        """Stub del motor de prueba: no se ejerce en los tests de cola D3."""
        return RouterTrace(
            matched_route="general_chat",
            branch="general_chat",
            keyword=None,
            keyword_priority=None,
            intent=None,
            response=None,
            confidence=0.0,
            steps=[RouterStep(order=0, branch="general_chat", outcome="fallthrough", detail="stub")],
        )


class _StubAdapter(IChannelAdapter):
    """Adaptador de canal mínimo para ejercitar el worker."""

    @property
    def kind(self) -> str:
        return "stub"

    def parse_inbound(self, *, payload: Any) -> InboundMessage:
        return InboundMessage(channel_id=uuid.uuid4(), external_contact_id="stub", text=str(payload))

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        return True


class _StubAdapterFactory(IChannelSenderFactory):
    """Fábrica de adaptadores que siempre resuelve un :class:`_StubAdapter`."""

    def __init__(self, *, resolved: bool = True) -> None:
        self.resolved = resolved

    def resolve(self, *, channel_id: uuid.UUID) -> IChannelAdapter | None:
        if not self.resolved:
            return None
        return _StubAdapter()


def _create_channel(container: Container, tenant_id: uuid.UUID) -> TenantChannel:
    """Crea un canal WhatsApp real en el SQLite compartido (secretos únicos)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)
        return repo.create(
            tenant_id=tenant_id,
            channel_type="whatsapp",
            external_id=f"wa-f5-{uuid.uuid4().hex}",
            phone_number="5215500000000",
            phone_number_id=f"f5-{uuid.uuid4().hex}",
            access_token=f"EAAG-f5-{uuid.uuid4().hex}",
            webhook_secret=f"secret-{uuid.uuid4().hex}",
            enabled=True,
        )


def _stream_for(container: Container, tenant_id: uuid.UUID) -> str:
    """Devuelve el stream Redis de la cola D3 de un tenant."""
    return f"{container.settings.bot_queue_stream_prefix}:{tenant_id}"


def _build_service(container: Container, queue: IQueue, logger: ILogger) -> BotQueueService:
    """Construye el servicio con repositorios SQLAlchemy reales + cola falsa."""
    return BotQueueService(
        database=container.database,
        queue=queue,
        message_repository_factory=SqlAlchemyBotMessageRepository,
        conversation_repository_factory=SqlAlchemyBotConversationRepository,
        queue_meta_repository_factory=SqlAlchemyBotQueueMetaRepository,
        settings=container.settings,
        logger=logger,
    )


def _build_worker(
    container: Container,
    queue: IQueue,
    service: BotQueueService,
    *,
    processor: IConversationService | None,
    adapter_factory: IChannelSenderFactory | None,
    logger: ILogger,
) -> BotWorkerPool:
    """Construye un worker pool sin hilos para pruebas deterministas."""
    return BotWorkerPool(
        queue=queue,
        service=service,
        processor=processor,
        adapter_factory=adapter_factory,
        settings=container.settings,
        logger=logger,
    )


# ---------------------------------------------------------------------------
# BotQueueService
# ---------------------------------------------------------------------------


def test_enqueue_inbound_persists_and_enqueues(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)

    result = service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )

    assert result is True
    assert queue.xlen(stream) == 1
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_PENDING
        assert message.content == "Hola"
        assert message.direction == "inbound"
        conversation = (
            session.query(BotConversation)
            .filter_by(
                tenant_id=tenant_id,
                channel_id=channel.id,
                external_contact_id="wa-contact-1",
            )
            .first()
        )
        assert conversation is not None
        assert message.conversation_id == conversation.id
    assert any(event == "bot.queue.enqueued" for event, _, _ in logger.events)


def test_enqueue_inbound_duplicate_within_window(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)

    first = service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    second = service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola otra vez",
    )

    assert first is True
    assert second is False
    assert queue.xlen(stream) == 1
    with container.database.session_scope() as session:
        count = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).count()
        assert count == 1
    assert any(event == "bot.queue.duplicate" for event, _, _ in logger.events)


def test_enqueue_inbound_reactivates_outside_window(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)

    assert (
        service.enqueue_inbound(
            tenant_id=tenant_id,
            channel_id=channel.id,
            external_contact_id="wa-contact-1",
            message_id=message_id,
            content="Hola",
        )
        is True
    )
    # Retrocede created_at más allá de la ventana de deduplicación (300s).
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        message.created_at = utcnow() - timedelta(seconds=400)

    result = service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Reactivado",
    )

    assert result is True
    assert queue.xlen(stream) == 2
    with container.database.session_scope() as session:
        count = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).count()
        assert count == 1


def test_enqueue_inbound_redis_failure_returns_false(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    queue.enqueue_should_fail = True
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"

    result = service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )

    assert result is False
    assert any(event == "bot.queue.enqueue.redis.error" for event, _, _ in logger.events)
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_PENDING


def test_requeue_pending_reenqueues_db_pending(container: Container) -> None:
    tenant = uuid.uuid4()
    channel = _create_channel(container, tenant)
    logger = FakeLogger()
    queue = FakeQueue()
    queue.enqueue_should_fail = True
    service = _build_service(container, queue, logger)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant)

    assert (
        service.enqueue_inbound(
            tenant_id=tenant,
            channel_id=channel.id,
            external_contact_id="wa-contact-1",
            message_id=message_id,
            content="Hola",
        )
        is False
    )
    # El mensaje quedó pending en BD sin entrada en Redis (fail-closed).
    queue.enqueue_should_fail = False

    result = service.requeue_pending(tenant_id=tenant)

    assert result == 1
    assert queue.xlen(stream) == 1
    assert any(event == "bot.queue.requeue" for event, _, _ in logger.events)


def test_queue_stats_reflects_db_and_redis(container: Container) -> None:
    tenant = uuid.uuid4()
    channel = _create_channel(container, tenant)
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant)

    service.enqueue_inbound(
        tenant_id=tenant,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )

    stats = service.queue_stats(tenant_id=tenant)
    assert stats.stream == stream
    assert stats.length == 1
    assert stats.pending == 0
    assert stats.consumer_lag == 0
    assert stats.dlq_count == 0
    assert stats.enqueued == 1
    assert stats.processed == 0
    assert stats.failed == 0

    service.increment_dlq(tenant_id=tenant)
    stats = service.queue_stats(tenant_id=tenant)
    assert stats.dlq_count == 1

    assert (
        service.mark_message_status(tenant_id=tenant, message_id=message_id, queue_status=QUEUE_SENT) is True
    )
    stats = service.queue_stats(tenant_id=tenant)
    assert stats.enqueued == 0
    assert stats.processed == 1


def test_mark_message_status_unknown_returns_false(container: Container) -> None:
    service = _build_service(container, FakeQueue(), FakeLogger())

    result = service.mark_message_status(
        tenant_id=uuid.uuid4(),
        message_id="no-existe",
        queue_status=QUEUE_SENT,
    )

    assert result is False


def test_list_streams_returns_registered_streams(container: Container) -> None:
    tenant = uuid.uuid4()
    channel = _create_channel(container, tenant)
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    stream = _stream_for(container, tenant)

    assert stream not in service.list_streams()
    service.enqueue_inbound(
        tenant_id=tenant,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=f"msg-{uuid.uuid4().hex}",
        content="Hola",
    )
    assert stream in service.list_streams()


def test_close_closes_queue(container: Container) -> None:
    queue = FakeQueue()
    service = _build_service(container, queue, FakeLogger())

    service.close()

    assert queue.closed is True


# ---------------------------------------------------------------------------
# BotWorkerPool
# ---------------------------------------------------------------------------


def test_worker_dormant_without_processor(container: Container) -> None:
    logger = FakeLogger()
    service = _build_service(container, FakeQueue(), logger)
    worker = _build_worker(
        container,
        FakeQueue(),
        service,
        processor=None,
        adapter_factory=None,
        logger=logger,
    )

    worker.start()

    assert worker.is_running is False
    assert any(event == "bot.worker.dormant" for event, _, _ in logger.events)
    worker.stop()


def test_worker_process_message_success(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)
    service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    group = container.settings.bot_worker_group
    processor = FakeProcessor()
    adapter_factory = _StubAdapterFactory()
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )

    messages = queue.read_group(stream, group=group, consumer="test", count=1)
    assert len(messages) == 1
    worker._process_message(messages[0], consumer="test")

    assert (stream, group, messages[0].message_id) in queue.acked
    assert len(processor.calls) == 1
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_SENT
    assert any(event == "bot.worker.processed" for event, _, _ in logger.events)


def test_worker_process_message_malformed(container: Container) -> None:
    tenant = uuid.uuid4()
    stream = _stream_for(container, tenant)
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    group = container.settings.bot_worker_group
    processor = FakeProcessor()
    adapter_factory = _StubAdapterFactory()
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )
    # Faltan channel_id / external_contact_id → mensaje malformado.
    entry_id = queue.enqueue(stream, {"message_id": "malformed-1", "content": "Hola"})
    assert entry_id is not None
    messages = queue.read_group(stream, group=group, consumer="test", count=1)
    assert len(messages) == 1

    worker._process_message(messages[0], consumer="test")

    assert (stream, group, messages[0].message_id) in queue.acked
    dlq_stream = f"{container.settings.bot_queue_dlq_prefix}:{tenant}"
    assert len(queue.dlq.get(dlq_stream, [])) == 1
    assert queue.dlq[dlq_stream][0][1]["dlq_reason"] == "malformed"
    assert any(event == "bot.worker.malformed" for event, _, _ in logger.events)
    assert processor.calls == []


def test_worker_process_message_retry(container: Container, tenant_id: uuid.UUID) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)
    service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    group = container.settings.bot_worker_group
    processor = FakeProcessor(error=RuntimeError("boom"))
    adapter_factory = _StubAdapterFactory()
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )

    messages = queue.read_group(stream, group=group, consumer="test", count=1)
    assert len(messages) == 1
    assert messages[0].attempts == 0
    worker._process_message(messages[0], consumer="test")

    # Re-encolado con attempts=1 y el original reconocido.
    assert len(queue.entries[stream]) == 2
    assert queue.entries[stream][1][1]["attempts"] == "1"
    assert (stream, group, messages[0].message_id) in queue.acked
    assert any(event == "bot.worker.retry" for event, _, _ in logger.events)
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_PENDING


def test_worker_process_message_dlq_when_attempts_exhausted(
    container: Container, tenant_id: uuid.UUID
) -> None:
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)
    service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    group = container.settings.bot_worker_group
    processor = FakeProcessor(error=RuntimeError("boom"))
    adapter_factory = _StubAdapterFactory()
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )

    messages = queue.read_group(stream, group=group, consumer="test", count=1)
    assert len(messages) == 1
    exhausted = dataclasses.replace(messages[0], attempts=container.settings.bot_queue_max_attempts)
    worker._process_message(exhausted, consumer="test")

    dlq_stream = f"{container.settings.bot_queue_dlq_prefix}:{tenant_id}"
    assert len(queue.dlq.get(dlq_stream, [])) == 1
    assert (stream, group, messages[0].message_id) in queue.acked
    assert any(event == "bot.worker.dlq" for event, _, _ in logger.events)
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_FAILED
    stats = service.queue_stats(tenant_id=tenant_id)
    assert stats.dlq_count == 1


def test_worker_process_once_processes_stream(container: Container) -> None:
    tenant = uuid.uuid4()
    channel = _create_channel(container, tenant)
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    message_id = f"msg-{uuid.uuid4().hex}"
    service.enqueue_inbound(
        tenant_id=tenant,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    processor = FakeProcessor()
    adapter_factory = _StubAdapterFactory()
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )

    worker._process_once(consumer="test")

    assert processor.calls
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_SENT


def test_worker_process_message_adapter_unresolved_retries_then_dlq(
    container: Container, tenant_id: uuid.UUID
) -> None:
    """Fase 6.1: si el adaptador no se resuelve, reintenta y luego va a DLQ."""
    logger = FakeLogger()
    queue = FakeQueue()
    service = _build_service(container, queue, logger)
    channel = _create_channel(container, tenant_id)
    message_id = f"msg-{uuid.uuid4().hex}"
    stream = _stream_for(container, tenant_id)
    service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id="wa-contact-1",
        message_id=message_id,
        content="Hola",
    )
    group = container.settings.bot_worker_group
    processor = FakeProcessor()
    adapter_factory = _StubAdapterFactory(resolved=False)
    worker = _build_worker(
        container,
        queue,
        service,
        processor=processor,
        adapter_factory=adapter_factory,
        logger=logger,
    )

    messages = queue.read_group(stream, group=group, consumer="test", count=1)
    assert len(messages) == 1
    worker._process_message(messages[0], consumer="test")

    # Reintento: se re-encola con attempts=1 y el original se reconoce.
    assert len(queue.entries[stream]) == 2
    assert queue.entries[stream][1][1]["attempts"] == "1"
    assert (stream, group, messages[0].message_id) in queue.acked
    assert any(event == "bot.worker.retry" for event, _, _ in logger.events)
    assert processor.calls == []

    # Reintentos agotados: va a DLQ sin haber procesado (fail-closed).
    exhausted = dataclasses.replace(messages[0], attempts=container.settings.bot_queue_max_attempts)
    worker._process_message(exhausted, consumer="test")
    dlq_stream = f"{container.settings.bot_queue_dlq_prefix}:{tenant_id}"
    assert len(queue.dlq.get(dlq_stream, [])) == 1
    assert any(event == "bot.worker.dlq" for event, _, _ in logger.events)
    assert processor.calls == []
    with container.database.session_scope() as session:
        message = session.query(BotMessage).filter_by(tenant_id=tenant_id, message_id=message_id).first()
        assert message is not None
        assert message.queue_status == QUEUE_FAILED
