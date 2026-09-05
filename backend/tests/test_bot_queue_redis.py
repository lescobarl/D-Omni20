"""Pruebas del adaptador Redis Streams de la cola D3 (Fase 5.1).

Cubre :class:`RedisStreamQueue` con un cliente redis-py falso (monkeypatch de
``redis.Redis.from_url``) para ejercitar todos los caminos de éxito y de error
sin depender de un Redis real (protege el gate de cobertura >= 80 %).
"""

from __future__ import annotations

from typing import Any

import pytest
import redis
from app.bot.queue.redis_stream_queue import RedisStreamQueue
from app.config.settings import Settings

from tests.test_bot_queue import FakeLogger


class FakeRedisClient:
    """Cliente redis-py falso: registra llamadas y simula resultados/errores."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.next_id = "1-1"
        self.groups_created: set[str] = set()

        self.xadd_error: Exception | None = None
        self.last_xadd_stream: str | None = None
        self.last_xadd_fields: dict[str, str] | None = None

        self.xreadgroup_response: Any = None
        self.xreadgroup_error: Exception | None = None

        self.xack_result = 1
        self.xack_error: Exception | None = None

        self.xpending_range_result: list[dict[str, Any]] = []
        self.xpending_range_error: Exception | None = None

        self.xclaim_result: list[tuple[str, dict[str, str]]] = []
        self.xclaim_error: Exception | None = None

        self.xlen_result: Any = 3
        self.xlen_error: Exception | None = None

        self.xpending_result: Any = {"pending": 2}
        self.xpending_error: Exception | None = None

        self.xinfo_groups_result: list[dict[str, Any]] = []
        self.xinfo_groups_error: Exception | None = None

        self.close_error: Exception | None = None
        self.closed = False

    def xgroup_create(self, stream: str, group: str, **kwargs: Any) -> None:
        self.calls.append("xgroup_create")
        if group in self.groups_created:
            raise redis.ResponseError("BUSYGROUP Consumer Group name already exists")
        self.groups_created.add(group)

    def xadd(self, stream: str, fields: dict[str, str], **kwargs: Any) -> str:
        self.calls.append("xadd")
        if self.xadd_error is not None:
            raise self.xadd_error
        self.last_xadd_stream = stream
        self.last_xadd_fields = dict(fields)
        return self.next_id

    def xreadgroup(
        self, group: str, consumer: str, streams: dict[str, str], **kwargs: Any
    ) -> Any:
        self.calls.append("xreadgroup")
        if self.xreadgroup_error is not None:
            raise self.xreadgroup_error
        return self.xreadgroup_response

    def xack(self, stream: str, group: str, message_id: str) -> int:
        self.calls.append("xack")
        if self.xack_error is not None:
            raise self.xack_error
        return self.xack_result

    def xpending_range(self, stream: str, group: str, **kwargs: Any) -> list[dict[str, Any]]:
        self.calls.append("xpending_range")
        if self.xpending_range_error is not None:
            raise self.xpending_range_error
        return self.xpending_range_result

    def xclaim(
        self,
        stream: str,
        group: str,
        consumer: str,
        min_idle_ms: int,
        ids: list[str],
    ) -> Any:
        self.calls.append("xclaim")
        if self.xclaim_error is not None:
            raise self.xclaim_error
        return self.xclaim_result

    def xlen(self, stream: str) -> Any:
        self.calls.append("xlen")
        if self.xlen_error is not None:
            raise self.xlen_error
        return self.xlen_result

    def xpending(self, stream: str, group: str) -> Any:
        self.calls.append("xpending")
        if self.xpending_error is not None:
            raise self.xpending_error
        return self.xpending_result

    def xinfo_groups(self, stream: str) -> list[dict[str, Any]]:
        self.calls.append("xinfo_groups")
        if self.xinfo_groups_error is not None:
            raise self.xinfo_groups_error
        return self.xinfo_groups_result

    def close(self) -> None:
        self.calls.append("close")
        if self.close_error is not None:
            raise self.close_error
        self.closed = True


def _build_queue(
    monkeypatch: pytest.MonkeyPatch,
    settings: Settings,
    fake: FakeRedisClient,
    logger: FakeLogger,
) -> RedisStreamQueue:
    """Construye la cola con el cliente redis-py sustituido por el fake."""
    monkeypatch.setattr(
        redis.Redis,
        "from_url",
        classmethod(lambda cls, *args, **kwargs: fake),  # type: ignore[arg-type]
    )
    return RedisStreamQueue(settings=settings, logger=logger)


def test_enqueue_xadd_success(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    entry_id = queue.enqueue("bot:queue:abc", {"message_id": "m1"})

    assert entry_id == "1-1"
    assert "xadd" in fake.calls


def test_enqueue_xadd_error_returns_none(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xadd_error = redis.RedisError("redis down")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    result = queue.enqueue("bot:queue:abc", {"message_id": "m1"})

    assert result is None
    assert any(event == "bot.queue.xadd.error" for event, _, _ in logger.events)


def test_read_group_returns_messages(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xreadgroup_response = [
        ("bot:queue:abc", [("1-1", {"message_id": "m1", "attempts": "2"})])
    ]
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    messages = queue.read_group("bot:queue:abc", group="g", consumer="c", count=5)

    assert len(messages) == 1
    assert messages[0].message_id == "1-1"
    assert messages[0].attempts == 2
    assert messages[0].fields["message_id"] == "m1"


def test_read_group_tolerates_bad_attempts(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xreadgroup_response = [
        ("bot:queue:abc", [("1-1", {"message_id": "m1", "attempts": "abc"})])
    ]
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    messages = queue.read_group("bot:queue:abc", group="g", consumer="c", count=5)

    assert messages[0].attempts == 0


def test_read_group_creates_group_on_nogroup(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xreadgroup_error = redis.ResponseError("NOGROUP No such key or consumer group")
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    result = queue.read_group("bot:queue:abc", group="g", consumer="c", count=5)

    assert result == []
    assert "xgroup_create" in fake.calls


def test_read_group_other_error_returns_empty(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xreadgroup_error = redis.ResponseError("WRONGTYPE ...")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    result = queue.read_group("bot:queue:abc", group="g", consumer="c", count=5)

    assert result == []
    assert any(event == "bot.queue.read.error" for event, _, _ in logger.events)


def test_read_group_redis_error_returns_empty(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xreadgroup_error = redis.RedisError("redis down")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    result = queue.read_group("bot:queue:abc", group="g", consumer="c", count=5)

    assert result == []
    assert any(event == "bot.queue.read.error" for event, _, _ in logger.events)


def test_ensure_group_handles_busygroup(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    queue._ensure_group("bot:queue:abc")
    queue._ensure_group("bot:queue:abc")  # BUSYGROUP → se ignora

    assert "xgroup_create" in fake.calls
    assert not any(event == "bot.queue.group.error" for event, _, _ in logger.events)


def test_ack_success(monkeypatch: pytest.MonkeyPatch, test_settings: Settings) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.ack("bot:queue:abc", group="g", message_id="1-1") is True


def test_ack_error_returns_false(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xack_error = redis.RedisError("redis down")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    result = queue.ack("bot:queue:abc", group="g", message_id="1-1")

    assert result is False
    assert any(event == "bot.queue.ack.error" for event, _, _ in logger.events)


def test_claim_returns_messages(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_range_result = [
        {"message_id": "1-1", "owner": "other", "delivery_count": 1}
    ]
    fake.xclaim_result = [("1-1", {"message_id": "m1", "attempts": "1"})]
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    messages = queue.claim(
        "bot:queue:abc", group="g", consumer="c", min_idle_ms=1000, count=5
    )

    assert len(messages) == 1
    assert messages[0].message_id == "1-1"
    assert messages[0].attempts == 1
    assert "xclaim" in fake.calls


def test_claim_no_pending_ids_returns_empty(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_range_result = []
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    messages = queue.claim(
        "bot:queue:abc", group="g", consumer="c", min_idle_ms=1000, count=5
    )

    assert messages == []
    assert "xclaim" not in fake.calls


def test_claim_xpending_error_returns_empty(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_range_error = redis.RedisError("redis down")
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    messages = queue.claim(
        "bot:queue:abc", group="g", consumer="c", min_idle_ms=1000, count=5
    )

    assert messages == []


def test_claim_xclaim_error_returns_empty(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_range_result = [{"message_id": "1-1"}]
    fake.xclaim_error = redis.RedisError("redis down")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    messages = queue.claim(
        "bot:queue:abc", group="g", consumer="c", min_idle_ms=1000, count=5
    )

    assert messages == []
    assert any(event == "bot.queue.claim.error" for event, _, _ in logger.events)


def test_xlen_success(monkeypatch: pytest.MonkeyPatch, test_settings: Settings) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.xlen("bot:queue:abc") == 3


def test_xlen_error_returns_zero(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xlen_error = redis.RedisError("redis down")
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.xlen("bot:queue:abc") == 0


def test_xlen_non_int_returns_zero(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xlen_result = "no-es-un-numero"
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.xlen("bot:queue:abc") == 0


def test_pending_success(monkeypatch: pytest.MonkeyPatch, test_settings: Settings) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.pending("bot:queue:abc", group="g") == 2


def test_pending_error_returns_zero(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_error = redis.RedisError("redis down")
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.pending("bot:queue:abc", group="g") == 0


def test_pending_non_dict_returns_zero(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xpending_result = None
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.pending("bot:queue:abc", group="g") == 0


def test_consumer_lag_success(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xinfo_groups_result = [{"name": "bot-workers", "lag": 5}]
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.consumer_lag("bot:queue:abc", group="bot-workers") == 5


def test_consumer_lag_not_found_returns_none(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xinfo_groups_result = [{"name": "otro-grupo", "lag": 5}]
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.consumer_lag("bot:queue:abc", group="bot-workers") is None


def test_consumer_lag_error_returns_none(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.xinfo_groups_error = redis.RedisError("redis down")
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    assert queue.consumer_lag("bot:queue:abc", group="bot-workers") is None


def test_to_dlq_adds_metadata(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    entry_id = queue.to_dlq("bot:queue:abc", {"message_id": "m1"}, reason="malformed")

    assert entry_id == "1-1"
    assert fake.last_xadd_stream == "bot:dlq:abc"
    assert fake.last_xadd_fields is not None
    assert fake.last_xadd_fields["original_stream"] == "bot:queue:abc"
    assert fake.last_xadd_fields["dlq_reason"] == "malformed"


def test_close_success(monkeypatch: pytest.MonkeyPatch, test_settings: Settings) -> None:
    fake = FakeRedisClient()
    queue = _build_queue(monkeypatch, test_settings, fake, FakeLogger())

    queue.close()

    assert fake.closed is True


def test_close_error_warns(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings
) -> None:
    fake = FakeRedisClient()
    fake.close_error = redis.RedisError("redis down")
    logger = FakeLogger()
    queue = _build_queue(monkeypatch, test_settings, fake, logger)

    queue.close()

    assert any(event == "bot.queue.close.error" for event, _, _ in logger.events)
