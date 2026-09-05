"""Firma y verificación de tokens del Portal del Cliente (C-3).

Regla CLAUDE: nada de "objetos dummy" ni secretos hardcodeados. El token del
portal es un formato compacto ``payload.signature`` donde:

- ``payload`` es el JSON ``{"tenant_id", "email", "exp"}`` codificado en urlsafe
  base64 (sin padding).
- ``signature`` es el HMAC-SHA256 de ese payload con ``portal_token_secret``;
  la verificación compara firmas en tiempo constante con
  :func:`hmac.compare_digest` (mitiga ataques de temporización).

La clave secreta SIEMPRE se inyecta por argumento (desde
``container.settings.portal_token_secret``); este módulo nunca lee variables de
entorno ni instancia configuración por sí mismo (regla CLAUDE: DI / sin
hardcode).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.core.errors import ConfigValidationError, TenantIsolationError

_DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 1 día de vigencia por defecto
_TOKEN_PARTS = 2
_OPERATION_VERIFY = "portal.token.verify"


def _b64url_encode(data: bytes) -> str:
    """Codifica bytes a urlsafe base64 sin padding (compacto)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    """Decodifica urlsafe base64 sin padding; falla con contexto si es inválido."""
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as exc:
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={"detail": "El token no es urlsafe base64 válido."},
        ) from exc


def _require_secret(*, secret: str) -> None:
    """Valida que el secreto del portal esté configurado (fail-closed)."""
    if not secret:
        raise ConfigValidationError(
            "portal_token_secret no configurado",
            operation="portal.token.init",
            context={"requirement": "PORTAL_TOKEN_SECRET no vacío"},
        )


def _signature(*, secret: str, payload_b64: str) -> str:
    """Calcula el HMAC-SHA256 del payload codificado (firma del token)."""
    digest = hmac.new(
        secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


@dataclass(frozen=True)
class PortalTokenClaims:
    """Reclamaciones verificadas de un token del Portal del Cliente."""

    tenant_id: uuid.UUID
    email: str
    expires_at: datetime


def sign_portal_token(
    *,
    secret: str,
    tenant_id: uuid.UUID,
    email: str,
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
) -> str:
    """Firma un token del portal con HMAC-SHA256 y devuelve ``payload.signature``.

    :param secret: ``container.settings.portal_token_secret`` (inyectado).
    :param tenant_id: tenant al que queda acotado el token.
    :param email: correo del cliente (el router lo normaliza a minúsculas).
    :param ttl_seconds: vigencia del token en segundos (por defecto 24 h).
    """
    _require_secret(secret=secret)
    if ttl_seconds <= 0:
        raise ConfigValidationError(
            "ttl_portal_token_invalido",
            operation="portal.token.sign",
            context={"ttl_seconds": ttl_seconds},
        )
    expires_at = int(datetime.now(timezone.utc).timestamp()) + ttl_seconds
    payload = json.dumps(
        {
            "tenant_id": str(tenant_id),
            "email": email,
            "exp": expires_at,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload_b64 = _b64url_encode(payload)
    return f"{payload_b64}.{_signature(secret=secret, payload_b64=payload_b64)}"


def verify_portal_token(*, secret: str, token: str) -> PortalTokenClaims:
    """Verifica firma y vigencia de un token del portal; devuelve sus reclamaciones.

    Lanza :class:`TenantIsolationError` (403) si el token es inválido, la firma
    no corresponde al secreto o ya expiró. La comparación de firmas se hace en
    tiempo constante (:func:`hmac.compare_digest`).
    """
    _require_secret(secret=secret)
    parts = token.split(".")
    if len(parts) != _TOKEN_PARTS or not all(parts):
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={
                "detail": "Formato de token inválido (se espera payload.signature)."
            },
        )
    payload_b64, signature_b64 = parts
    expected = _signature(secret=secret, payload_b64=payload_b64)
    if not hmac.compare_digest(signature_b64, expected):
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={"detail": "La firma del token no coincide con el secreto."},
        )
    try:
        payload: dict[str, Any] = json.loads(
            _b64url_decode(payload_b64).decode("utf-8")
        )
    except (ValueError, TypeError, UnicodeDecodeError) as exc:
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={"detail": "El payload del token no es JSON válido."},
        ) from exc
    try:
        tenant_id = uuid.UUID(str(payload.get("tenant_id", "")))
        email = str(payload.get("email", ""))
        expires_at = datetime.fromtimestamp(
            int(payload.get("exp", 0)), tz=timezone.utc
        )
    except (ValueError, TypeError, KeyError) as exc:
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={"detail": "El payload del token no tiene reclamaciones válidas."},
        ) from exc
    if not email:
        raise TenantIsolationError(
            "token_portal_invalido",
            operation=_OPERATION_VERIFY,
            context={"detail": "El payload del token no incluye un correo."},
        )
    if expires_at <= datetime.now(timezone.utc):
        raise TenantIsolationError(
            "token_portal_expirado",
            operation=_OPERATION_VERIFY,
            context={"detail": "El token del portal ha expirado."},
        )
    return PortalTokenClaims(tenant_id=tenant_id, email=email, expires_at=expires_at)
