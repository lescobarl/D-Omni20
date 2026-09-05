"""tenant_config_tables_rls

Fase 1 — tablas ``tenant_appearance``, ``content_items``, ``catalog_items`` y
``tenant_channels`` con RLS.

- Crea las cuatro tablas de configuración del tenant con la tupla sync
  ``[revision, updated_at, deleted]``.
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod las tablas quedarían
  sin RLS y expuestas a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente) para mantener el mismo contrato de la tupla sync en prod.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager
from app.models.base import JSONType

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = ("tenant_appearance", "content_items", "catalog_items", "tenant_channels")


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        "tenant_appearance",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("primary_color", sa.String(length=9), nullable=False),
        sa.Column("accent_color", sa.String(length=9), nullable=False),
        sa.Column("surface_color", sa.String(length=9), nullable=False),
        sa.Column("text_color", sa.String(length=9), nullable=False),
        sa.Column("brand_badge", sa.String(length=9), nullable=False),
        sa.Column("logo_url", sa.String(length=512), nullable=True),
        sa.Column("font_family", sa.String(length=128), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_appearance_tenant"),
    )
    op.create_index(
        op.f("ix_tenant_appearance_tenant_id"), "tenant_appearance", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_appearance_deleted"), "tenant_appearance", ["deleted"], unique=False
    )

    op.create_table(
        "content_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tags", JSONType, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_content_items_tenant_id"), "content_items", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_content_items_kind"), "content_items", ["kind"], unique=False)
    op.create_index(op.f("ix_content_items_deleted"), "content_items", ["deleted"], unique=False)

    op.create_table(
        "catalog_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("metadata", JSONType, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "sku", name="uq_catalog_tenant_sku"),
    )
    op.create_index(op.f("ix_catalog_items_tenant_id"), "catalog_items", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_catalog_items_available"), "catalog_items", ["available"], unique=False)
    op.create_index(op.f("ix_catalog_items_deleted"), "catalog_items", ["deleted"], unique=False)

    op.create_table(
        "tenant_channels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("channel_type", sa.String(length=32), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("phone_number", sa.String(length=32), nullable=False),
        sa.Column("phone_number_id", sa.String(length=64), nullable=True),
        sa.Column("encrypted_access_token", sa.Text(), nullable=False),
        sa.Column("encrypted_webhook_secret", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "channel_type", "external_id", name="uq_tenant_channel_type_external"
        ),
    )
    op.create_index(
        op.f("ix_tenant_channels_tenant_id"), "tenant_channels", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_channels_channel_type"), "tenant_channels", ["channel_type"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_channels_deleted"), "tenant_channels", ["deleted"], unique=False
    )

    if _is_postgresql():
        manager = RLSManager(schema="public")
        for table in _TABLES:
            _apply_rls(manager, table)

        # Trigger de incremento de ``revision`` en UPDATE (tupla sync en prod).
        # CREATE OR REPLACE: idempotente y compartido con la migración PSEO.
        op.execute(
            """
            CREATE OR REPLACE FUNCTION public.pseo_bump_sync_revision() RETURNS trigger AS $$
            BEGIN
                NEW.revision := OLD.revision + 1;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        for table in _TABLES:
            op.execute(
                f"CREATE TRIGGER trg_{table}_bump_revision "
                f"BEFORE UPDATE ON public.{table} "
                f"FOR EACH ROW EXECUTE FUNCTION public.pseo_bump_sync_revision();"
            )


def downgrade() -> None:
    if _is_postgresql():
        for table in _TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_bump_revision ON public.{table};")

    op.drop_index(op.f("ix_tenant_channels_deleted"), table_name="tenant_channels")
    op.drop_index(op.f("ix_tenant_channels_channel_type"), table_name="tenant_channels")
    op.drop_index(op.f("ix_tenant_channels_tenant_id"), table_name="tenant_channels")
    op.drop_table("tenant_channels")

    op.drop_index(op.f("ix_catalog_items_deleted"), table_name="catalog_items")
    op.drop_index(op.f("ix_catalog_items_available"), table_name="catalog_items")
    op.drop_index(op.f("ix_catalog_items_tenant_id"), table_name="catalog_items")
    op.drop_table("catalog_items")

    op.drop_index(op.f("ix_content_items_deleted"), table_name="content_items")
    op.drop_index(op.f("ix_content_items_kind"), table_name="content_items")
    op.drop_index(op.f("ix_content_items_tenant_id"), table_name="content_items")
    op.drop_table("content_items")

    op.drop_index(op.f("ix_tenant_appearance_deleted"), table_name="tenant_appearance")
    op.drop_index(op.f("ix_tenant_appearance_tenant_id"), table_name="tenant_appearance")
    op.drop_table("tenant_appearance")
