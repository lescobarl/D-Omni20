"""Tests del escalado automático a intervención humana (eslabón ⑤).

Cubre la función pura :func:`app.bot.conversation_service._auto_escalate`:
una conversación con ``needs_human`` crea una intervención ``pending`` y no se
duplica si ya existe una intervención abierta (``pending``/``assigned``).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import Mock

from app.bot.conversation_service import _auto_escalate


class _FakeIntervention:
    """Intervención mínima (duck typing) con el atributo `conversation_id`."""

    def __init__(self, conversation_id: uuid.UUID) -> None:
        self.conversation_id = conversation_id


class _FakeRepo:
    """Doble del repositorio de intervenciones (solo lo usado por `_auto_escalate`)."""

    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.open: list[_FakeIntervention] = []

    def list_by_state(
        self, *, tenant_id: uuid.UUID, state: str, page: int, page_size: int
    ) -> tuple[list[_FakeIntervention], int]:
        del tenant_id, page, page_size
        if state in ("pending", "assigned"):
            return self.open, len(self.open)
        return [], 0

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        state: str,
        operator: str | None,
        notes: str | None,
        assigned_at: datetime | None,
        resolved_at: datetime | None,
    ) -> _FakeIntervention:
        del tenant_id, operator, assigned_at, resolved_at
        self.created.append(
            {"conversation_id": conversation_id, "state": state, "notes": notes}
        )
        return _FakeIntervention(conversation_id)


def _run(repo: _FakeRepo, conversation_id: uuid.UUID) -> bool:
    return _auto_escalate(
        repo,  # type: ignore[arg-type]
        tenant_id=uuid.uuid4(),
        conversation_id=conversation_id,
        notes="Escalado automático E2E",
        logger=Mock(),
    )


def test_escalates_creates_pending_when_none_open() -> None:
    conversation_id = uuid.uuid4()
    repo = _FakeRepo()

    created = _run(repo, conversation_id)

    assert created is True
    assert len(repo.created) == 1
    assert repo.created[0]["conversation_id"] == conversation_id
    assert repo.created[0]["state"] == "pending"


def test_escalates_is_idempotent_when_pending_exists() -> None:
    conversation_id = uuid.uuid4()
    repo = _FakeRepo()
    repo.open = [_FakeIntervention(conversation_id)]

    created = _run(repo, conversation_id)

    assert created is False
    assert repo.created == []


def test_escalates_is_idempotent_when_assigned_exists() -> None:
    conversation_id = uuid.uuid4()
    repo = _FakeRepo()
    repo.open = [_FakeIntervention(conversation_id)]

    created = _run(repo, conversation_id)

    assert created is False
    assert repo.created == []


def test_escalates_allows_other_conversation() -> None:
    conversation_id = uuid.uuid4()
    repo = _FakeRepo()
    repo.open = [_FakeIntervention(uuid.uuid4())]

    created = _run(repo, conversation_id)

    assert created is True
    assert len(repo.created) == 1
    assert repo.created[0]["conversation_id"] == conversation_id
