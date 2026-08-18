"""Pruebas del logging estructurado JSON (regla CLAUDE: log de auditoría)."""

from __future__ import annotations

import json
import logging

from app.core.logging import (
    JsonLogFormatter,
    StructuredLogger,
    _make_file_handler,
    build_logger,
)
from app.core.tenancy import RequestContext


def _payload_from_record(record: logging.LogRecord) -> dict:
    return json.loads(JsonLogFormatter().format(record))


def test_structured_logger_emits_json_payload(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="test.logger"):
        logger = StructuredLogger("test.logger", "INFO")
        logger.info("test.event", "hola mundo", foo="bar", n=1)

    matching = [r for r in caplog.records if r.name == "test.logger"]
    assert matching
    payload = _payload_from_record(matching[-1])
    assert payload["level"] == "INFO"
    assert payload["event"] == "test.event"
    assert payload["message"] == "hola mundo"
    assert payload["fields"] == {"foo": "bar", "n": 1}


def test_structured_logger_levels(caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="test.logger.levels"):
        logger = StructuredLogger("test.logger.levels", "WARNING")
        logger.info("ignored", "no aparece")
        logger.error("boom", "aparece")
    records = [r for r in caplog.records if r.name == "test.logger.levels"]
    assert records
    assert all(r.levelname == "ERROR" for r in records)


def test_json_formatter_includes_request_context() -> None:
    RequestContext.new_request()
    RequestContext.set_tenant("00000000-0000-0000-0000-000000000000")
    RequestContext.set_user("user-1")
    record = logging.LogRecord("test", logging.INFO, "file.py", 1, "msg", None, None)
    payload = _payload_from_record(record)
    assert payload["context"]["request_id"]
    assert payload["context"]["tenant_id"] == "00000000-0000-0000-0000-000000000000"
    assert payload["context"]["user_id"] == "user-1"


def test_json_formatter_omits_context_when_empty() -> None:
    RequestContext.reset()
    record = logging.LogRecord("test", logging.INFO, "file.py", 1, "msg", None, None)
    payload = _payload_from_record(record)
    assert "context" not in payload


def test_build_logger_attaches_root_handlers_once(test_settings) -> None:
    root = logging.getLogger()
    before = len(root.handlers)

    logger = build_logger("test.build", test_settings)
    assert logger is not None
    if before == 0:
        assert len(root.handlers) >= 1

    # Una segunda llamada no debe duplicar handlers del root.
    after_first = len(root.handlers)
    build_logger("test.build.2", test_settings)
    assert len(root.handlers) == after_first


def test_file_handler_writes_json_lines(tmp_path) -> None:
    log_path = str(tmp_path / "app.jsonl")
    handler = _make_file_handler(log_path, max_bytes=1024, backup_count=1)

    logger = logging.getLogger("test.file.handler")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger.addHandler(handler)
    try:
        logger.info("file.event", extra={"event": "file.event", "fields": {"k": "v"}})
    finally:
        handler.close()
        logger.removeHandler(handler)

    content = (tmp_path / "app.jsonl").read_text(encoding="utf-8")
    payload = json.loads(content.strip())
    assert payload["event"] == "file.event"
    assert payload["fields"] == {"k": "v"}
