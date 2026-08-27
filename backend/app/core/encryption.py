"""Cifrado simétrico de tokens OAuth en reposo (Fase 3 del backlog).

Regla CLAUDE: nada de "objetos dummy" — los tokens de Google se persisten
cifrados con ``cryptography.fernet`` (AES-128-CBC + HMAC-SHA256 autenticado),
nunca en texto plano y nunca con hashing invertible trivial.

:class:`TokenCipher` acepta dos formatos de clave:
- Una clave Fernet ya válida (32 bytes en urlsafe base64) — uso avanzado.
- Un secreto arbitrario (>= 32 caracteres) del que se deriva la clave Fernet
  con SHA-256 (cifrado determinista y autenticado con la misma clave).
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.errors import ConfigValidationError

_MIN_KEY_LENGTH = 32


class TokenCipher:
    """Cifra/descifra tokens OAuth con Fernet (autenticado) en reposo."""

    _MIN_KEY_LENGTH = _MIN_KEY_LENGTH

    def __init__(self, key: str) -> None:
        if not key:
            raise ConfigValidationError(
                "token_encryption_key no configurado",
                operation="encryption.init",
                context={"requirement": "TOKEN_ENCRYPTION_KEY no vacío"},
            )
        if len(key) < _MIN_KEY_LENGTH:
            raise ConfigValidationError(
                "token_encryption_key demasiado corto",
                operation="encryption.init",
                context={"min_length": _MIN_KEY_LENGTH, "received": len(key)},
            )
        try:
            # Si el operador aporta una clave Fernet válida, se usa tal cual.
            self._fernet = Fernet(key.encode("utf-8"))
        except (ValueError, TypeError):
            # Si no, se deriva la clave Fernet del secreto con SHA-256.
            digest = hashlib.sha256(key.encode("utf-8")).digest()
            self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, plaintext: str) -> str:
        """Cifra texto plano y devuelve el token cifrado (str urlsafe base64)."""
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt(self, ciphertext: str) -> str:
        """Descifra un token cifrado; lanza error con contexto si es inválido."""
        try:
            return self._fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError) as exc:
            raise ConfigValidationError(
                "token_oauth_no_descifrable",
                operation="encryption.decrypt",
                context={
                    "detail": "El token cifrado no pudo descifrarse "
                    "(¿cambió TOKEN_ENCRYPTION_KEY o se corrompió el dato?)."
                },
            ) from exc
