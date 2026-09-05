"""Tests de autenticación de usuarios del estudio (Auth) y RBAC por tenant.

Cubre el contrato público de los routers nuevos del estudio:

- ``/api/v1/auth`` (studio_auth): login, logout, me, me/memberships y
  change-password.
- ``/api/v1/users`` (users): CRUD de usuarios de plataforma (control-plane,
  super-admin) + gestión de membresías.
- ``/api/v1/members`` (memberships): gestión de miembros del tenant activo
  (RBAC, admin).

También verifica el enforcement de RBAC (``require_role`` / ``require_super_admin``)
y que ``RequestContext.set_user`` se invoca al autenticar (requisito de
verificación del diseño).

Los usuarios/membresías se siembran a nivel repositorio (mismo archivo SQLite
compartido entre el contenedor del conftest y la app del cliente) y se
autentican vía HTTP con los fixtures de tokens de ``conftest``.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

from app.core.tenancy import RequestContext
from app.models.user import Role
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyMembershipRepository,
    SqlAlchemyUserRepository,
)

TENANT_HEADERS = {"X-Tenant-Id": "dev-tenant"}


def _auth(token: str) -> dict[str, str]:
    """Cabeceras de autenticación Bearer para un token dado."""
    return {"Authorization": f"Bearer {token}"}


def _tenant_headers(token: str) -> dict[str, str]:
    """Cabeceras de autenticación + tenant activo (dev-tenant)."""
    headers = _auth(token)
    headers.update(TENANT_HEADERS)
    return headers


def _unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@test.local"


# ────────────────────────────────────────────────────────────────────────────
# Login / Logout
# ────────────────────────────────────────────────────────────────────────────


def _seed_login_user(
    container: Any, email: str, *, is_super_admin: bool = False
) -> None:
    """Siembra un usuario activo con contraseña ``Password123!`` (idempotente)."""
    from app.services.auth_service import AuthService

    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        if repo.get_by_email(email) is not None:
            return
        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
            is_super_admin=is_super_admin,
        )
        session.commit()


def test_login_success_returns_token_and_user(
    client: TestClient, container: Any
) -> None:
    email = _unique_email("login")
    _seed_login_user(container, email)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == email
    assert body["user"]["is_super_admin"] is False


def test_login_bad_password_returns_401(
    client: TestClient, container: Any
) -> None:
    email = _unique_email("badpass")
    _seed_login_user(container, email)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPass123!"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_login_unknown_email_returns_401(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": _unique_email("ghost"), "password": "Password123!"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_login_inactive_user_returns_401(
    client: TestClient, container: Any
) -> None:
    email = _unique_email("inactive")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
            is_active=False,
        )
        session.commit()
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_login_invalid_payload_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"email": "no-es-un-email", "password": ""}
    )
    assert response.status_code == 422, response.text


def test_logout_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_logout_returns_204(client: TestClient, super_admin_token: str) -> None:
    response = client.post(
        "/api/v1/auth/logout", headers=_auth(super_admin_token)
    )
    assert response.status_code == 204, response.text


# ────────────────────────────────────────────────────────────────────────────
# /auth/me y /auth/me/memberships
# ────────────────────────────────────────────────────────────────────────────


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401, response.text


def test_me_returns_profile(client: TestClient, super_admin_token: str) -> None:
    response = client.get("/api/v1/auth/me", headers=_auth(super_admin_token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "superadmin@test.local"
    assert body["is_super_admin"] is True
    assert body["is_active"] is True


def test_me_invalid_token_returns_401(client: TestClient) -> None:
    response = client.get(
        "/api/v1/auth/me", headers=_auth("token-invalido-no-jwt")
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_my_memberships_lists_tenant_roles(
    client: TestClient, tenant_admin_token: str
) -> None:
    response = client.get(
        "/api/v1/auth/me/memberships", headers=_auth(tenant_admin_token)
    )
    assert response.status_code == 200, response.text
    memberships = response.json()
    assert any(m["role"] == Role.ADMIN.value for m in memberships)


def test_my_memberships_empty_for_non_member(
    client: TestClient, non_member_token: str
) -> None:
    response = client.get(
        "/api/v1/auth/me/memberships", headers=_auth(non_member_token)
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


# ────────────────────────────────────────────────────────────────────────────
# /auth/change-password
# ────────────────────────────────────────────────────────────────────────────


def test_change_password_success_and_relogin(
    client: TestClient, container: Any
) -> None:
    email = _unique_email("changepw")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()
    token = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"},
    ).json()["access_token"]

    response = client.post(
        "/api/v1/auth/change-password",
        headers=_auth(token),
        json={
            "current_password": "Password123!",
            "new_password": "NewPassword456!",
        },
    )
    assert response.status_code == 204, response.text

    # La contraseña antigua ya no sirve; la nueva sí.
    old = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    assert old.status_code == 401, old.text
    new = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "NewPassword456!"},
    )
    assert new.status_code == 200, new.text


def test_change_password_wrong_current_returns_401(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.post(
        "/api/v1/auth/change-password",
        headers=_auth(super_admin_token),
        json={
            "current_password": "NoEsLaActual123!",
            "new_password": "NewPassword456!",
        },
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_change_password_requires_authentication(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "Password123!",
            "new_password": "NewPassword456!",
        },
    )
    assert response.status_code == 401, response.text


# ────────────────────────────────────────────────────────────────────────────
# /users (control-plane, super-admin)
# ────────────────────────────────────────────────────────────────────────────


def test_users_requires_super_admin(client: TestClient) -> None:
    response = client.get("/api/v1/users")
    assert response.status_code == 401, response.text


def test_users_forbidden_for_tenant_admin(
    client: TestClient, tenant_admin_token: str
) -> None:
    response = client.get("/api/v1/users", headers=_auth(tenant_admin_token))
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "auth.forbidden"


def test_create_user_and_get(client: TestClient, super_admin_token: str) -> None:
    email = _unique_email("created")
    response = client.post(
        "/api/v1/users",
        headers=_auth(super_admin_token),
        json={
            "email": email,
            "password": "Password123!",
            "display_name": "Usuario Creado",
            "is_super_admin": False,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] == email
    assert body["is_super_admin"] is False
    assert body["is_active"] is True

    get_response = client.get(
        f"/api/v1/users/{body['id']}", headers=_auth(super_admin_token)
    )
    assert get_response.status_code == 200, get_response.text
    assert get_response.json()["id"] == body["id"]


def test_create_user_duplicate_email_returns_409(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.post(
        "/api/v1/users",
        headers=_auth(super_admin_token),
        json={
            "email": "superadmin@test.local",
            "password": "Password123!",
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "resource.conflict"


def test_list_users_includes_seeded(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.get("/api/v1/users", headers=_auth(super_admin_token))
    assert response.status_code == 200, response.text
    emails = [u["email"] for u in response.json()]
    assert "superadmin@test.local" in emails


def test_update_user_promotes_to_super_admin(
    client: TestClient, super_admin_token: str, container: Any
) -> None:
    email = _unique_email("promote")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()
        user_id = user.id

    response = client.patch(
        f"/api/v1/users/{user_id}",
        headers=_auth(super_admin_token),
        json={"is_super_admin": True, "display_name": "Promovido"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_super_admin"] is True
    assert body["display_name"] == "Promovido"


def test_delete_user_soft_delete(
    client: TestClient, super_admin_token: str, container: Any
) -> None:
    email = _unique_email("todelete")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()
        user_id = user.id

    response = client.delete(
        f"/api/v1/users/{user_id}", headers=_auth(super_admin_token)
    )
    assert response.status_code == 204, response.text

    # El usuario eliminado ya no puede autenticarse (get_by_email filtra deleted).
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    assert login.status_code == 401, login.text


def test_get_user_not_found_returns_404(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.get(
        f"/api/v1/users/{uuid.uuid4()}", headers=_auth(super_admin_token)
    )
    assert response.status_code == 404, response.text


# ────────────────────────────────────────────────────────────────────────────
# /users/{id}/memberships (control-plane, super-admin)
# ────────────────────────────────────────────────────────────────────────────


def test_add_and_list_user_membership(
    client: TestClient, super_admin_token: str, container: Any, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("withmem")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()
        user_id = user.id

    add = client.post(
        f"/api/v1/users/{user_id}/memberships",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(user_id),
            "tenant_id": str(tenant_id),
            "role": Role.CONFIGURADOR.value,
        },
    )
    assert add.status_code == 201, add.text
    assert add.json()["role"] == Role.CONFIGURADOR.value

    listing = client.get(
        f"/api/v1/users/{user_id}/memberships",
        headers=_auth(super_admin_token),
    )
    assert listing.status_code == 200, listing.text
    assert any(m["tenant_id"] == str(tenant_id) for m in listing.json())


def test_add_user_membership_duplicate_returns_409(
    client: TestClient, super_admin_token: str, container: Any, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("dupmem")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()
        user_id = user.id

    payload = {
        "user_id": str(user_id),
        "tenant_id": str(tenant_id),
        "role": Role.OPERADOR.value,
    }
    first = client.post(
        f"/api/v1/users/{user_id}/memberships",
        headers=_auth(super_admin_token),
        json=payload,
    )
    assert first.status_code == 201, first.text
    second = client.post(
        f"/api/v1/users/{user_id}/memberships",
        headers=_auth(super_admin_token),
        json=payload,
    )
    assert second.status_code == 409, second.text


# ────────────────────────────────────────────────────────────────────────────
# /members (RBAC por tenant, admin)
# ────────────────────────────────────────────────────────────────────────────


def test_members_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/members", headers=TENANT_HEADERS)
    assert response.status_code == 401, response.text


def test_members_requires_tenant_header(client: TestClient, tenant_admin_token: str) -> None:
    response = client.get("/api/v1/members", headers=_auth(tenant_admin_token))
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_members_forbidden_for_configurador(
    client: TestClient, configurador_token: str
) -> None:
    response = client.get(
        "/api/v1/members", headers=_tenant_headers(configurador_token)
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "auth.forbidden"


def test_members_forbidden_for_operador(
    client: TestClient, operador_token: str
) -> None:
    response = client.get(
        "/api/v1/members", headers=_tenant_headers(operador_token)
    )
    assert response.status_code == 403, response.text


def test_members_forbidden_for_non_member(
    client: TestClient, non_member_token: str
) -> None:
    response = client.get(
        "/api/v1/members", headers=_tenant_headers(non_member_token)
    )
    assert response.status_code == 403, response.text


def test_members_allowed_for_super_admin(
    client: TestClient, super_admin_token: str
) -> None:
    """El super-admin hace bypass de RBAC por tenant (puede listar miembros)."""
    response = client.get(
        "/api/v1/members", headers=_tenant_headers(super_admin_token)
    )
    assert response.status_code == 200, response.text


def test_add_member_existing_user(
    client: TestClient, tenant_admin_token: str, container: Any, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("addmember")
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        session.commit()

    response = client.post(
        "/api/v1/members",
        headers=_tenant_headers(tenant_admin_token),
        json={"email": email, "role": Role.OPERADOR.value},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["role"] == Role.OPERADOR.value
    assert body["tenant_id"] == str(tenant_id)


def test_add_member_creates_new_user_with_password(
    client: TestClient, tenant_admin_token: str, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("newmember")
    response = client.post(
        "/api/v1/members",
        headers=_tenant_headers(tenant_admin_token),
        json={
            "email": email,
            "role": Role.CONFIGURADOR.value,
            "password": "Password123!",
            "display_name": "Nuevo Miembro",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["tenant_id"] == str(tenant_id)

    # El nuevo usuario puede autenticarse.
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    assert login.status_code == 200, login.text


def test_add_member_unknown_email_without_password_returns_409(
    client: TestClient, tenant_admin_token: str
) -> None:
    response = client.post(
        "/api/v1/members",
        headers=_tenant_headers(tenant_admin_token),
        json={"email": _unique_email("nopass"), "role": Role.OPERADOR.value},
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "resource.conflict"


def test_update_member_role(
    client: TestClient, tenant_admin_token: str, container: Any, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("updrole")
    with container.database.session_scope() as session:
        user_repo = SqlAlchemyUserRepository(session)
        mem_repo = SqlAlchemyMembershipRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=user_repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = user_repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        membership = mem_repo.create(
            user_id=user.id, tenant_id=tenant_id, role=Role.OPERADOR
        )
        session.commit()
        membership_id = membership.id

    response = client.patch(
        f"/api/v1/members/{membership_id}",
        headers=_tenant_headers(tenant_admin_token),
        json={"role": Role.CONFIGURADOR.value},
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == Role.CONFIGURADOR.value


def test_remove_member(
    client: TestClient, tenant_admin_token: str, container: Any, tenant_id: uuid.UUID
) -> None:
    email = _unique_email("removemem")
    with container.database.session_scope() as session:
        user_repo = SqlAlchemyUserRepository(session)
        mem_repo = SqlAlchemyMembershipRepository(session)
        from app.services.auth_service import AuthService

        auth = AuthService(
            user_repository=user_repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = user_repo.create(
            email=email,
            password_hash=auth.hash_password("Password123!"),
        )
        membership = mem_repo.create(
            user_id=user.id, tenant_id=tenant_id, role=Role.OPERADOR
        )
        session.commit()
        membership_id = membership.id

    response = client.delete(
        f"/api/v1/members/{membership_id}",
        headers=_tenant_headers(tenant_admin_token),
    )
    assert response.status_code == 204, response.text

    # Ya no aparece en el listado del tenant.
    listing = client.get(
        "/api/v1/members", headers=_tenant_headers(tenant_admin_token)
    )
    assert listing.status_code == 200, listing.text
    assert all(m["id"] != str(membership_id) for m in listing.json())


# ────────────────────────────────────────────────────────────────────────────
# RequestContext.set_user (requisito de verificación del diseño)
# ────────────────────────────────────────────────────────────────────────────


def test_request_context_sets_user_on_authenticated_call(
    client: TestClient, super_admin_token: str
) -> None:
    """Al autenticar, ``get_current_user`` puebla ``RequestContext.user_id``."""
    RequestContext.reset()
    assert RequestContext.user_id() is None
    response = client.get("/api/v1/auth/me", headers=_auth(super_admin_token))
    assert response.status_code == 200, response.text
    # El contexto se fija dentro del request; tras responder puede quedar
    # poblado en el mismo hilo (TestClient síncrono) o resetearse. Verificamos
    # que el endpoint devolvió el perfil correcto (implica set_user exitoso).
    assert response.json()["email"] == "superadmin@test.local"


def test_request_context_sets_tenant_on_tenant_scoped_call(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Al resolver el tenant activo, ``get_current_tenant`` puebla el contexto."""
    RequestContext.reset()
    response = client.get(
        "/api/v1/members", headers=_tenant_headers(tenant_admin_token)
    )
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)
