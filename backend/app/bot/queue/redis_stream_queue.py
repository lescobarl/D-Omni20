"""Implementación Redis Streams de la cola D3 (Fase 5.1).

``RedisStreamQueue`` materializa :class:`IQueue` sobre Redis Streams:

- Un stream ``bot:queue:{tenant_id}`` por tenant (XADD / XREADGROUP).
- Grupo de consumidores ``bot-workers`` con PEL (at-least-once, XACK).
- AOF habilitado en el servidor Redis para durabilidad (requisito D3).
- DLQ derivado ``bot:dlq:{tenant_id}`` para mensajes fallidos definitivos.
- ``XCLAIM`` para reclamar entradas abandonadas (idle > claim_timeout).
- ``XTRIM MAXLEN`` aproximado para acotar memoria por stream.

Toda operación falla cerrado (devuelve ``None``/``0``/``[]`` y loguea) para que
la fuente de verdad (``bot_messages`` en BD) permita el re-encolado posterior.
"""

from __future__ import annotations

from typing import Any

import redis

from app.bot.queue.interfaces import IQueue, StreamMessage
from app.config.settings import Settings
from app.core.logging import ILogger


def _parse_attempts(fields: dict[str, str]) -> int:
    """Lee el contador de intentos de un mensaje de forma tolerante."""
    try:
        return int(fields.get("attempts", "0") or "0")
    except (TypeError, ValueError):
        return 0


def _extract_message_id(entry: dict[str, Any]) -> str | None:
    """Extrae el ID de una entrada de ``xpending_range`` de forma defensiva.

    redis-py puede exponer la clave como ``message_id`` o ``id`` según la
    versión; se aceptan ambas para robustez.
    """
    value = entry.get("message_id") or entry.get("id")
    return str(value) if value else None


class RedisStreamQueue(IQueue):
    """Cola D3 sobre Redis Streams (redis-py 5.x, ``decode_responses=True``)."""

    def __init__(self, *, settings: Settings, logger: ILogger) -> None:
        self._settings = settings
        self._logger = logger
        self._group = settings.bot_worker_group
        self._maxlen = settings.bot_queue_maxlen
        self._client: redis.Redis = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=settings.redis_connect_timeout_seconds,
            socket_timeout=settings.redis_operation_timeout_seconds,
        )

    # ── Helpers ─────────────────────────────────────────────────────────────
    def _tenant_from_stream(self, stream: str) -> str:
        return stream.rsplit(":", 1)[-1]

    def _dlq_stream(self, stream: str) -> str:
        tenant = self._tenant_from_stream(stream)
        return f"{self._settings.bot_queue_dlq_prefix}:{tenant}"

    def _ensure_group(self, stream: str) -> None:
        """Crea el grupo de consumidores la primera vez (``MKSTREAM``).

        Se ancla en ``id="0"`` (inicio del stream), no en ``"$"`` (final): la
        primera lectura con ``XREADGROUP ... >`` debe entregar también las
        entradas encoladas ANTES de la creación del grupo. Con ``"$"`` un grupo
        recién creado tras un ``XADD`` se posiciona al final y **descarta en
        silencio** todas las entradas previas (raíz de los mensajes ``pending``
        que nunca se procesaban).
        """
        try:
            self._client.xgroup_create(stream, self._group, id="0", mkstream=True)
        except redis.ResponseError:
            # BUSYGROUP (el grupo ya existe): esperado, no es un error.
            return
        except redis.RedisError as exc:
            self._logger.error(
                "bot.queue.group.error",
                stream=stream,
                group=self._group,
                error=str(exc),
            )

    def _parse_group_entries(self, stream: str, raw: Any) -> list[StreamMessage]:
        """Parsea el resultado anidado de XREADGROUP: ``[[name, [[id, fields]]]]``."""
        messages: list[StreamMessage] = []
        for _name, entries in raw or []:
            for message_id, fields in entries or []:
                parsed = dict(fields)
                messages.append(
                    StreamMessage(
                        stream=stream,
                        message_id=str(message_id),
                        fields=parsed,
                        attempts=_parse_attempts(parsed),
                    )
                )
        return messages

    def _parse_claim_entries(self, stream: str, raw: Any) -> list[StreamMessage]:
        """Parsea el resultado plano de XCLAIM: ``[[id, fields]]``."""
        messages: list[StreamMessage] = []
        for message_id, fields in raw or []:
            parsed = dict(fields)
            messages.append(
                StreamMessage(
                    stream=stream,
                    message_id=str(message_id),
                    fields=parsed,
                    attempts=_parse_attempts(parsed),
                )
            )
        return messages

    # ── Puerto IQueue ───────────────────────────────────────────────────────
    def enqueue(self, stream: str, fields: dict[str, str]) -> str | None:
        try:
            return str(
                self._client.xadd(
                    stream,
                    fields,
                    maxlen=self._maxlen,
                    approximate=True,
                )
            )
        except redis.RedisError as exc:
            self._logger.error(
                "bot.queue.xadd.error",
                stream=stream,
                error=str(exc),
            )
            return None

    def read_group(
        self,
        stream: str,
        group: str,
        consumer: str,
        count: int,
    ) -> list[StreamMessage]:
        try:
            raw = self._client.xreadgroup(
                group,
                consumer,
                {stream: ">"},
                count=count,
                block=None,
            )
        except redis.ResponseError as exc:
            if "NOGROUP" in str(exc):
                self._ensure_group(stream)
                return []
            self._logger.error(
                "bot.queue.read.error",
                stream=stream,
                group=group,
                error=str(exc),
            )
            return []
        except redis.RedisError as exc:
            self._logger.error(
                "bot.queue.read.error",
                stream=stream,
                group=group,
                error=str(exc),
            )
            return []
        return self._parse_group_entries(stream, raw)

    def ack(self, stream: str, group: str, message_id: str) -> bool:
        try:
            return bool(self._client.xack(stream, group, message_id))
        except redis.RedisError as exc:
            self._logger.error(
                "bot.queue.ack.error",
                stream=stream,
                message_id=message_id,
                error=str(exc),
            )
            return False

    def claim(
        self,
        stream: str,
        group: str,
        consumer: str,
        min_idle_ms: int,
        count: int,
    ) -> list[StreamMessage]:
        try:
            pending = self._client.xpending_range(
                stream,
                group,
                min=0,
                max="+",
                count=count,
            )
        except redis.RedisError:
            # Grupo/stream inexistente aún: no hay nada que reclamar.
            return []
        ids = [
            message_id
            for entry in pending or []
            if (message_id := _extract_message_id(entry)) is not None
        ]
        if not ids:
            return []
        try:
            raw = self._client.xclaim(stream, group, consumer, min_idle_ms, ids)
        except redis.RedisError as exc:
            self._logger.error(
                "bot.queue.claim.error",
                stream=stream,
                error=str(exc),
            )
            return []
        return self._parse_claim_entries(stream, raw)

    def xlen(self, stream: str) -> int:
        try:
            return int(self._client.xlen(stream))
        except (redis.RedisError, TypeError, ValueError):
            return 0

    def pending(self, stream: str, group: str) -> int:
        try:
            summary = self._client.xpending(stream, group)
        except redis.RedisError:
            return 0
        if not isinstance(summary, dict):
            return 0
        try:
            return int(summary.get("pending", 0) or 0)
        except (TypeError, ValueError):
            return 0

    def consumer_lag(self, stream: str, group: str) -> int | None:
        try:
            groups = self._client.xinfo_groups(stream)
        except redis.RedisError:
            return None
        for info in groups or []:
            if info.get("name") == group:
                lag = info.get("lag")
                try:
                    return int(lag) if lag is not None else None
                except (TypeError, ValueError):
                    return None
        return None

    def to_dlq(self, stream: str, fields: dict[str, str], reason: str) -> str | None:
        payload: dict[str, str] = dict(fields)
        payload["original_stream"] = stream
        payload["dlq_reason"] = reason
        return self.enqueue(self._dlq_stream(stream), payload)

    def close(self) -> None:
        try:
            self._client.close()
        except redis.RedisError as exc:  # pragma: no cover - cierre best-effort
            self._logger.warning("bot.queue.close.error", error=str(exc))


__all__ = ["RedisStreamQueue"]
