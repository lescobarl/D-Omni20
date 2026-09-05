"""auth_rbac_tables

Auth + RBAC de los usuarios del estudio (control-plane, sin RLS).

Crea las dos tablas de control-plane que sustentan la autenticación de los
usuarios del estudio y el RBAC por tenant:

- ``users`` — usuario de plataforma (email único, password_hash bcrypt,
  display_name, is_super_admin, is_active, last_login_at). Control-plane: sin
  RLS ni ``tenant_id`` (un super-admin debe poder ver todos los tenants).
- ``tenant_memberships`` — membresía de un usuario en un tenant con un rol
  (``admin`` | ``configurador`` | ``operador``), única por (user_id, tenant_id).
  Control-plane: sin RLS; el aislamiento por tenant se resuelve a nivel de
  aplicación (verificación de membresía).

Ambas tablas llevan tupla sync ``[revision, updated_at, deleted]`` y, como se
actualizan (cambio de contraseña, rol, perfil), en PostgreSQL se les añade el
trigger ``trg_<tabla>_bump_revision`` que reutiliza la función compartida
``public.pseo_bump_sync_revision`` (CREATE OR REPLACE idempotente del grafo
base). En SQLite/dev/tests el incremento de ``revision`` lo hace el evento
Python ``before_update`` de ``SyncTupleMixin``.

Revision ID: a0b1c2d3e4f5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: str | Sequence[str] | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Tablas con tupla sync que se actualizan: trigger de bump de ``revision``.
_TRIGGER_TABLES = ("users", "tenant_memberships")


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    # --- 1. users (control-plane, sin RLS) ---
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("is_super_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.create_index(op.f("ix_users_deleted"), "users", ["deleted"], unique=False)

    # --- 2. tenant_memberships (control-plane, sin RLS) ---
    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "ADMIN",
                "CONFIGURADOR",
                "OPERADOR",
                name="role_enum",
                native_enum=False,
                length=32,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "tenant_id", name="uq_membership_user_tenant"),
    )
    op.create_index(
        op.f("ix_tenant_memberships_user_id"), "tenant_memberships", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_memberships_tenant_id"), "tenant_memberships", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_memberships_deleted"), "tenant_memberships", ["deleted"], unique=False
    )

    # --- 3. Trigger de bump de revision (solo PostgreSQL) ---
    if _is_postgresql():
        for table in _TRIGGER_TABLES:
            op.execute(
                f"CREATE TRIGGER trg_{table}_bump_revision "
                f"BEFORE UPDATE ON public.{table} "
                f"FOR EACH ROW EXECUTE FUNCTION public.pseo_bump_sync_revision();"
            )


def downgrade() -> None:
    if _is_postgresql():
        for table in _TRIGGER_TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_bump_revision ON public.{table};")

    op.drop_index(op.f("ix_tenant_memberships_deleted"), table_name="tenant_memberships")
    op.drop_index(op.f("ix_tenant_memberships_tenant_id"), table_name="tenant_memberships")
    op.drop_index(op.f("ix_tenant_memberships_user_id"), table_name="tenant_memberships")
    op.drop_table("tenant_memberships")

    op.drop_index(op.f("ix_users_deleted"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
