"""Provisiona los usuarios RBAC de referencia en la DB de desarrollo y valida el login.

Los usuarios por perfil (admin/configurador/operador/super-admin) que se usan en
la suite de tests sólo existen en la DB de tests. Este script los siembra en la
DB de desarrollo real (``omnibotia_dev.db``) para que el login de la aplicación
funcione de verdad, y a continuación valida el flujo completo vía HTTP
(``POST /api/v1/auth/login``) con un ``TestClient`` en proceso.

Idempotente: por email, si el usuario ya existe no se duplica; las membresías se
aseguran por (user_id, tenant_id).

Uso (desde ``backend/``)::

    python -m scripts.provision_rbac_users
"""

from __future__ import annotations

import sys
import uuid

from fastapi.testclient import TestClient

from app.config.settings import get_settings
from app.core.di import build_container
from app.main import create_app
from app.models.user import Role
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyMembershipRepository,
    SqlAlchemyTenantRepository,
    SqlAlchemyUserRepository,
)
from app.services.auth_service import AuthService

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# Contraseña común de referencia (misma que en tests/conftest.py).
PASSWORD = "Password123!"

# Super-admin de plataforma (control plane): no lleva membresía por tenant.
SUPER_ADMIN_EMAIL = "superadmin@test.local"
SUPER_ADMIN_NAME = "Super Admin"

# (email, display_name, rol_en_tenant_dev)
# Solo los 3 perfiles por tenant definidos (admin/configurador/operador).
USERS: tuple[tuple[str, str, Role], ...] = (
    ("tenantadmin@test.local", "Tenant Admin", Role.ADMIN),
    ("configurador@test.local", "Configurador", Role.CONFIGURADOR),
    ("operador@test.local", "Operador", Role.OPERADOR),
)


def _seed_user(container, *, email: str, display_name: str, is_super_admin: bool) -> uuid.UUID:
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        existing = repo.get_by_email(email)
        if existing is not None:
            return existing.id
        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password(PASSWORD),
            display_name=display_name,
            is_super_admin=is_super_admin,
            is_active=True,
        )
        session.commit()
        return user.id


def _seed_membership(container, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: Role) -> None:
    with container.database.session_scope() as session:
        repo = SqlAlchemyMembershipRepository(session)
        existing = repo.get_by_user_and_tenant(user_id=user_id, tenant_id=tenant_id)
        if existing is not None:
            return
        repo.create(user_id=user_id, tenant_id=tenant_id, role=role)
        session.commit()


def main() -> None:
    settings = get_settings()
    container = build_container(settings)

    try:
        # Asegura que existan las tablas (users, tenant_memberships, ...).
        from app.models.base import Base

        Base.metadata.create_all(container.database.engine)

        with container.database.session_scope() as session:
            tenant = SqlAlchemyTenantRepository(session).get_by_slug(settings.dev_tenant_slug)
            if tenant is None:
                print(f"[provision] ERROR: tenant '{settings.dev_tenant_slug}' no existe.")
                return
            tenant_id = tenant.id

        print(f"[provision] Tenant dev: '{settings.dev_tenant_slug}' ({tenant_id})")
        print(f"[provision] Contraseña común: {PASSWORD}")

        # Super-admin de plataforma (sin membresía por tenant; control plane).
        _seed_user(
            container,
            email=SUPER_ADMIN_EMAIL,
            display_name=SUPER_ADMIN_NAME,
            is_super_admin=True,
        )
        print(
            f"[provision] Usuario listo: {SUPER_ADMIN_EMAIL} "
            f"(display='{SUPER_ADMIN_NAME}', super_admin)"
        )

        for email, display_name, role in USERS:
            user_id = _seed_user(
                container,
                email=email,
                display_name=display_name,
                is_super_admin=False,
            )
            _seed_membership(
                container, user_id=user_id, tenant_id=tenant_id, role=role
            )
            print(
                f"[provision] Usuario listo: {email} "
                f"(display='{display_name}', rol_dev={role.value})"
            )

        # ── Validación end-to-end del login vía HTTP ────────────────────────
        app = create_app(settings)
        with TestClient(app) as client:
            print("\n[validate] Validando POST /api/v1/auth/login ...")
            accounts = [SUPER_ADMIN_EMAIL, *(email for email, _name, _role in USERS)]
            for email in accounts:
                response = client.post(
                    "/api/v1/auth/login",
                    json={"email": email, "password": PASSWORD},
                )
                if response.status_code == 200:
                    body = response.json()
                    token = body.get("access_token", "")
                    user = body.get("user", {})
                    print(
                        f"[validate] OK  {email:32s} -> 200, token_len={len(token)}, "
                        f"user.email={user.get('email')}, display={user.get('display_name')}"
                    )
                else:
                    print(
                        f"[validate] FAIL {email:32s} -> {response.status_code} "
                        f"{response.text[:200]}"
                    )

            # Comprobación negativa: credencial incorrecta debe dar 401.
            bad = client.post(
                "/api/v1/auth/login",
                json={"email": "operador@test.local", "password": "wrong-password"},
            )
            print(
                f"[validate] Negativo (password errónea) -> {bad.status_code} "
                f"(esperado 401)"
            )
    finally:
        container.dispose()


if __name__ == "__main__":
    main()
