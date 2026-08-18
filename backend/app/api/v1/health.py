"""Endpoint de salud (liveness/readiness sin tenant requerido)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_session
from app.core.di import Container

router = APIRouter(tags=["health"])


class HealthResponse:
    """Respuesta de salud: metadatos + estado de la base de datos."""

    def __init__(self, *, status: str, database: str, **metadata) -> None:
        self.status = status
        self.database = database
        self.metadata = metadata
        self.time = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "database": self.database,
            "time": self.time,
            **self.metadata,
        }


@router.get("/health")
def health(
    container: Container = Depends(get_container),
    session: Session = Depends(get_session),
) -> dict:
    """Reporta versión, entorno y conectividad de la base de datos."""
    try:
        session.execute(text("SELECT 1"))
        database_status = "up"
    except Exception:  # noqa: BLE001 - liveness no debe propagar el fallo de la DB
        database_status = "down"

    response = HealthResponse(
        status="ok" if database_status == "up" else "degraded",
        database=database_status,
        app_name=container.settings.app_name,
        app_version=container.settings.app_version,
        backend_env=container.settings.backend_env,
    )
    return response.to_dict()
