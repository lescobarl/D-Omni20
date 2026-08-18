"""Logging estructurado JSON (regla CLAUDE: log de auditoría estructurado).

Contrato:
- Puerto :class:`ILogger` (ABC) + implementación :class:`StructuredLogger`.
- Cada entrada es una línea JSON con: ``timestamp`` (ISO), ``level``,
  ``logger``, ``event``, ``message``, ``fields`` y el contexto de request
  (``request_id``, ``tenant_id``, ``user_id``) inyectado automáticamente.
- La composición de handlers (consola + archivo rotativo) ocurre solo en
  ``build_logger`` (composition root), nunca en lógica de negocio.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any

from app.config.settings import Settings
from app.core.tenancy import RequestContext


class ILogger:
    """Puerto de logging estructurado (inyectable, sin acoplar al stdlib).

    ``event`` es un nombre canónico (ej. ``landing.created``); ``fields`` es
    contexto estructurado adicional serializable a JSON.
    """

    def debug(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError

    def info(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError

    def warning(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError

    def error(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError

    def critical(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError

    def exception(self, event: str, message: str = "", **fields: Any) -> None:  # pragma: no cover
        raise NotImplementedError


class JsonLogFormatter(logging.Formatter):
    """Formatea cada registro como una línea JSON autocontenida.

    Incluye el contexto de correlación del request (contextvars) para que los
    logs de un mismo request sean trazables de extremo a extremo.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "event", None) or record.getMessage(),
            "message": record.getMessage(),
            "fields": getattr(record, "fields", None) or {},
        }
        # Contexto de correlación por request (nunca variables globales).
        context = RequestContext.as_dict()
        if any(context.values()):
            payload["context"] = context
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class StructuredLogger(ILogger):
    """Implementación de :class:`ILogger` sobre el stdlib ``logging``."""

    _LEVEL_MAP: dict[str, int] = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }

    def __init__(self, name: str, level: str = "INFO") -> None:
        self._logger = logging.getLogger(name)
        self._logger.setLevel(self._LEVEL_MAP.get(level.upper(), logging.INFO))

    def _log(self, level: int, event: str, message: str, fields: dict[str, Any]) -> None:
        self._logger.log(level, message, extra={"event": event, "fields": fields})

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self._log(logging.DEBUG, event, message, fields)

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self._log(logging.INFO, event, message, fields)

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self._log(logging.WARNING, event, message, fields)

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self._log(logging.ERROR, event, message, fields)

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self._log(logging.CRITICAL, event, message, fields)

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self._logger.exception(message, extra={"event": event, "fields": fields})


def _make_console_handler() -> logging.Handler:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    return handler


def _make_file_handler(log_path: str, max_bytes: int, backup_count: int) -> logging.Handler:
    directory = os.path.dirname(os.path.abspath(log_path))
    os.makedirs(directory, exist_ok=True)
    handler = RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    handler.setFormatter(JsonLogFormatter())
    return handler


def build_logger(name: str, settings: Settings) -> ILogger:
    """Composition root del logging: consola + archivo rotativo con formato JSON.

    Se adjuntan handlers solo si el logger raíz aún no los tiene, evitando
    duplicados en tests y recargas de uvicorn (--reload).
    """
    root = logging.getLogger()
    if not root.handlers:
        root.setLevel(StructuredLogger._LEVEL_MAP.get(settings.log_level.upper(), logging.INFO))
        root.addHandler(_make_console_handler())
        root.addHandler(_make_file_handler(settings.log_dir + "/app.jsonl", settings.log_max_bytes, settings.log_backup_count))
    return StructuredLogger(name, settings.log_level)
