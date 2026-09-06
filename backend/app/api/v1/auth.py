"""Endpoints de OAuth 2.0 para Google Calendar (autorización y callback).

Mitad OAuth de ``/auth``: estas rutas (``/auth/google/*``) son disjuntas de la
mitad de sesión del estudio (``/auth/login|me|logout|change-password``, ver
``studio_auth.py``). Se mantienen en routers separados porque su contrato y su
ciclo de vida difieren (OAuth externo con callback fijo vs sesión propia).

Contrato:
- ``GET /auth/google/authorize`` devuelve la URL de autorización; responde 501
  cuando el proveedor no está configurado (sin credenciales OAuth).
- ``GET /auth/google/callback`` intercambia el código de autorización por un
  access token y reporta el estado de autenticación.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_google_calendar_provider
from app.services.providers import decode_oauth_state
from app.services.workflow_interfaces import IGoogleCalendarProvider

router = APIRouter(prefix="/auth", tags=["auth", "google-oauth"])


@router.get("/google/authorize")
def google_authorize(
    tenant_id: uuid.UUID | None = Query(default=None),
    provider: IGoogleCalendarProvider = Depends(get_google_calendar_provider),
) -> dict[str, str]:
    """Devuelve la URL de autorización OAuth 2.0 de Google Calendar.

    Cuando se provee ``tenant_id``, se embebe en el parámetro ``state`` para que
    el callback pueda persistir el token cifrado acotado a ese tenant (Fase 3).
    """
    url = provider.authorization_url_for(tenant_id=tenant_id)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google Calendar no está configurado (faltan credenciales OAuth).",
        )
    return {"authorization_url": url}


@router.get("/google/callback")
def google_callback(
    code: str = Query(..., min_length=1),
    state: str | None = Query(default=None),
    provider: IGoogleCalendarProvider = Depends(get_google_calendar_provider),
) -> dict[str, bool]:
    """Intercambia el código de autorización por un access token.

    Si el ``state`` devuelto por Google contiene un tenant codificado, el token
    se persiste cifrado y acotado a ese tenant (Fase 3).
    """
    tenant_id = decode_oauth_state(state) if state else None
    authenticated = provider.authenticate(auth_code=code, tenant_id=tenant_id)
    return {"authenticated": authenticated}
