"""Router de la API v1 (agrega health, designer y audit)."""

from fastapi import APIRouter

from app.api.v1 import audit, designer, health

v1_router = APIRouter()
v1_router.include_router(health.router)
v1_router.include_router(designer.router)
v1_router.include_router(audit.router)

__all__ = ["v1_router"]
