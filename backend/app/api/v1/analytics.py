"""Endpoints de analítica avanzada (Fase 9): registro y dashboard por tenant."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    get_analytics_repository,
    get_audit_service,
    get_current_tenant,
    require_role,
)
from app.models.user import Role, User
from app.repositories.interfaces import IAnalyticsRepository
from app.schemas.analytics import (
    AnalyticsDashboardResponse,
    AnalyticsEventCreateRequest,
    AnalyticsEventRead,
    AnalyticsEventTypeCount,
)
from app.services.interfaces import IAuditService

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post(
    "/events",
    response_model=AnalyticsEventRead,
    status_code=status.HTTP_201_CREATED,
)
def record_event(
    payload: AnalyticsEventCreateRequest,
    _auth: User = Depends(require_role(Role.ADMIN, Role.OPERADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IAnalyticsRepository = Depends(get_analytics_repository),
    audit: IAuditService = Depends(get_audit_service),
) -> AnalyticsEventRead:
    """Registra un evento de analítica del tenant activo (append-only)."""
    event = repository.record(
        tenant_id=tenant_id,
        event_type=payload.event_type,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        properties=payload.properties,
        occurred_at=payload.occurred_at,
    )
    audit.record(
        tenant_id=tenant_id,
        operation="analytics.event.record",
        entity_type="analytics_event",
        entity_id=str(event.id),
        details={"event_type": event.event_type},
    )
    return AnalyticsEventRead.model_validate(event)


@router.get("/dashboard", response_model=AnalyticsDashboardResponse)
def get_dashboard(
    _auth: User = Depends(require_role(Role.ADMIN, Role.OPERADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IAnalyticsRepository = Depends(get_analytics_repository),
) -> AnalyticsDashboardResponse:
    """Devuelve el dashboard agregado del tenant activo (totales y recientes)."""
    snapshot = repository.aggregate(tenant_id=tenant_id)
    recent = repository.recent(tenant_id=tenant_id, limit=10)
    return AnalyticsDashboardResponse(
        total_events=snapshot.total_events,
        by_event_type=[
            AnalyticsEventTypeCount(event_type=event_type, count=count)
            for event_type, count in sorted(
                snapshot.by_event_type.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ],
        recent=[AnalyticsEventRead.model_validate(event) for event in recent],
    )
