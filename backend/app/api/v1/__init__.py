"""Router de la API v1 (health, designer, ai, schemas, audit, workflows y auth)."""

from fastapi import APIRouter

from app.api.v1 import (
    ai,
    analytics,
    audit,
    auth,
    cdn,
    designer,
    generator,
    health,
    marketplace,
    schemas,
    workflows,
)

v1_router = APIRouter()
v1_router.include_router(health.router)
v1_router.include_router(designer.router)
v1_router.include_router(ai.router)
v1_router.include_router(marketplace.router)
v1_router.include_router(analytics.router)
v1_router.include_router(cdn.router)
v1_router.include_router(generator.router)
v1_router.include_router(schemas.router)
v1_router.include_router(audit.router)
v1_router.include_router(workflows.router)
v1_router.include_router(auth.router)

__all__ = ["v1_router"]
