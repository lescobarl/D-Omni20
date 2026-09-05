"""Servicio de autenticación de usuarios del estudio + RBAC (regla CLAUDE: DI).

Contrato:
- ``hash_password``/``verify_password``: bcrypt (hash con sal automática).
- ``create_access_token``/``decode_token``: JWT HS256 stateless (sin refresh).
- ``login``: verifica credenciales de un usuario activo y registra
  ``last_login_at``; lanza :class:`UnauthorizedError` si son inválidas.
- ``change_password``: valida la contraseña actual y la longitud mínima antes
  de actualizar el hash.

Nunca se instancia con ``new``: se inyecta el repositorio de usuarios, la
configuración y el logger desde el composition root.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config.settings import Settings
from app.core.errors import InputValidationError, UnauthorizedError
from app.core.logging import ILogger
from app.models.user import User
from app.repositories.interfaces import IUserRepository
from app.services.interfaces import IAuthService


class AuthService(IAuthService):
    def __init__(
        self,
        *,
        user_repository: IUserRepository,
        settings: Settings,
        logger: ILogger,
    ) -> None:
        self._user_repository = user_repository
        self._settings = settings
        self._logger = logger

    def hash_password(self, password: str) -> str:
        """Devuelve el hash bcrypt de ``password`` (sal generada automáticamente)."""
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def verify_password(self, password: str, password_hash: str) -> bool:
        """Comprueba ``password`` contra un hash bcrypt (seguro ante timing)."""
        try:
            return bcrypt.checkpw(
                password.encode("utf-8"), password_hash.encode("utf-8")
            )
        except ValueError:
            # Hash malformado o de otro esquema: nunca autenticar.
            return False

    def create_access_token(self, *, user_id: uuid.UUID) -> str:
        """Emite un JWT de acceso firmado con el secreto configurado."""
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(user_id),
            "iat": now,
            "exp": now
            + timedelta(minutes=self._settings.jwt_access_token_ttl_minutes),
        }
        return jwt.encode(
            payload,
            self._settings.jwt_secret,
            algorithm=self._settings.jwt_algorithm,
        )

    def decode_token(self, token: str) -> uuid.UUID:
        """Valida un JWT y devuelve el ``user_id``; lanza si es inválido/expirado."""
        try:
            payload = jwt.decode(
                token,
                self._settings.jwt_secret,
                algorithms=[self._settings.jwt_algorithm],
            )
        except jwt.PyJWTError as exc:
            raise UnauthorizedError(
                "Token de acceso inválido o expirado",
                operation="auth.decode_token",
                context={"reason": exc.__class__.__name__},
            ) from exc
        sub = payload.get("sub")
        if not sub:
            raise UnauthorizedError(
                "Token de acceso sin identificador de usuario",
                operation="auth.decode_token",
            )
        try:
            return uuid.UUID(sub)
        except (ValueError, TypeError) as exc:
            raise UnauthorizedError(
                "Identificador de usuario inválido en el token",
                operation="auth.decode_token",
            ) from exc

    def login(self, *, email: str, password: str) -> User:
        """Autentica un usuario activo por email+password.

        Lanza :class:`UnauthorizedError` si las credenciales son inválidas o el
        usuario está inactivo. Actualiza ``last_login_at`` en caso de éxito.
        """
        normalized = email.strip().lower()
        user = self._user_repository.get_by_email(normalized)
        if user is None or not self.verify_password(password, user.password_hash):
            raise UnauthorizedError(
                "Credenciales inválidas",
                operation="auth.login",
                context={"email": normalized},
            )
        if not user.is_active:
            raise UnauthorizedError(
                "El usuario está inactivo",
                operation="auth.login",
                context={"email": normalized},
            )
        self._user_repository.set_last_login(user.id, datetime.now(timezone.utc))
        self._logger.info(
            "login_ok",
            extra={"user_id": str(user.id), "email": normalized},
        )
        return user

    def change_password(
        self, *, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> None:
        """Cambia la contraseña de un usuario autenticado.

        Valida ``current_password`` y la longitud mínima de ``new_password``.
        """
        user = self._user_repository.get_by_id(user_id)
        if user is None or not self.verify_password(current_password, user.password_hash):
            raise UnauthorizedError(
                "La contraseña actual es incorrecta",
                operation="auth.change_password",
                context={"user_id": str(user_id)},
            )
        if len(new_password) < self._settings.password_min_length:
            raise InputValidationError(
                f"La nueva contraseña debe tener al menos "
                f"{self._settings.password_min_length} caracteres",
                operation="auth.change_password",
                context={"user_id": str(user_id)},
            )
        self._user_repository.update(
            user_id,
            password_hash=self.hash_password(new_password),
        )
        self._logger.info(
            "password_changed",
            extra={"user_id": str(user_id)},
        )
