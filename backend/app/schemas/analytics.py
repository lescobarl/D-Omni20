"""Esquemas de analítica avanzada (Fase 9)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class AnalyticsEventCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: str = Field(min_length=1, max_length=64)
    entity_type: str | None = Field(default=None, max_length=64)
    entity_id: str | None = Field(default=None, max_length=64)
    properties: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None


class AnalyticsEventRead(ORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    event_type: str
    entity_type: str | None
    entity_id: str | None
    properties: dict[str, Any]
    occurred_at: datetime
    created_at: datetime


class AnalyticsEventTypeCount(BaseModel):
    event_type: str
    count: int


class AnalyticsDashboardResponse(BaseModel):
    total_events: int
    by_event_type: list[AnalyticsEventTypeCount]
    recent: list[AnalyticsEventRead]
