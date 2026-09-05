"""Router de la API v1 (health, designer, ai, schemas, audit, workflows, auth
y dominios personalizados PSEO)."""

from fastapi import APIRouter

from app.api.v1 import (
    ads,
    ai,
    analytics,
    appearance,
    audit,
    auth,
    bot,
    catalog,
    cdn,
    channel_webhooks,
    channels,
    content,
    crm,
    designer,
    generator,
    health,
    keywords,
    marketplace,
    memberships,
    operations,
    portal,
    portal_pages,
    pseo_hosts,
    schemas,
    studio_auth,
    tenants,
    users,
    workflows,
)

v1_router = APIRouter()
v1_router.include_router(health.router)
v1_router.include_router(designer.router)
v1_router.include_router(ads.router)
v1_router.include_router(ai.router)
v1_router.include_router(marketplace.router)
v1_router.include_router(analytics.router)
v1_router.include_router(cdn.router)
v1_router.include_router(generator.router)
v1_router.include_router(schemas.router)
v1_router.include_router(audit.router)
v1_router.include_router(workflows.router)
v1_router.include_router(auth.router)
v1_router.include_router(appearance.router)
v1_router.include_router(content.router)
v1_router.include_router(catalog.router)
v1_router.include_router(channels.router)
v1_router.include_router(bot.router)
v1_router.include_router(keywords.router)
v1_router.include_router(channel_webhooks.router)
v1_router.include_router(operations.router)
v1_router.include_router(portal.router)
v1_router.include_router(portal_pages.router)
v1_router.include_router(pseo_hosts.router)
v1_router.include_router(tenants.router)
v1_router.include_router(crm.router)
v1_router.include_router(studio_auth.router)
v1_router.include_router(users.router)
v1_router.include_router(memberships.router)

__all__ = ["v1_router"]
