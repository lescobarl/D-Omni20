"""pseo_tables_rls

Fase D — tablas ``pseo_batches``, ``pseo_pages`` y ``pseo_hosts`` con RLS.

- Crea las tres tablas PSEO con la tupla sync ``[revision, updated_at, deleted]``.
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod las tablas quedarían
  sin RLS y expuestas a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL), el
  mismo contrato que el resto de modelos sync en prod (el evento Python
  ``before_update`` solo corre en dialectos no-PostgreSQL).

Revision ID: a1b2c3d4e5f6
Revises: 0a1b2c3d4e5f
Create Date: 2026-08-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "0a1b2c3d4e5f"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = ("pseo_batches", "pseo_pages", "pseo_hosts")


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        "pseo_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("matrix_hash", sa.String(length=64), nullable=False),
        sa.Column("template_version", sa.String(length=32), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("compiled_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pseo_batches_tenant_id"), "pseo_batches", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_pseo_batches_campaign_id"), "pseo_batches", ["campaign_id"], unique=False)
    op.create_index(op.f("ix_pseo_batches_matrix_hash"), "pseo_batches", ["matrix_hash"], unique=False)
    op.create_index(op.f("ix_pseo_batches_deleted"), "pseo_batches", ["deleted"], unique=False)

    op.create_table(
        "pseo_pages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("city", sa.String(length=255), nullable=False),
        sa.Column("service_slug", sa.String(length=255), nullable=False),
        sa.Column("service_name", sa.String(length=255), nullable=False),
        sa.Column("offer_price", sa.String(length=64), nullable=False),
        sa.Column("slug_path", sa.String(length=512), nullable=False),
        sa.Column("compiled_html", sa.Text(), nullable=True),
        sa.Column("canonical_url", sa.String(length=512), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["pseo_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug_path", name="uq_pseo_page_tenant_slug"),
    )
    op.create_index(op.f("ix_pseo_pages_tenant_id"), "pseo_pages", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_pseo_pages_batch_id"), "pseo_pages", ["batch_id"], unique=False)
    op.create_index(op.f("ix_pseo_pages_slug_path"), "pseo_pages", ["slug_path"], unique=False)
    op.create_index(op.f("ix_pseo_pages_published"), "pseo_pages", ["published"], unique=False)
    op.create_index(op.f("ix_pseo_pages_deleted"), "pseo_pages", ["deleted"], unique=False)

    op.create_table(
        "pseo_hosts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("host", name="uq_pseo_host_host"),
    )
    op.create_index(op.f("ix_pseo_hosts_tenant_id"), "pseo_hosts", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_pseo_hosts_host"), "pseo_hosts", ["host"], unique=False)
    op.create_index(op.f("ix_pseo_hosts_deleted"), "pseo_hosts", ["deleted"], unique=False)

    if _is_postgresql():
        manager = RLSManager(schema="public")
        for table in _TABLES:
            _apply_rls(manager, table)

        # Trigger de incremento de ``revision`` en UPDATE (tupla sync en prod).
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
        op.execute("DROP FUNCTION IF EXISTS public.pseo_bump_sync_revision();")

    op.drop_index(op.f("ix_pseo_hosts_deleted"), table_name="pseo_hosts")
    op.drop_index(op.f("ix_pseo_hosts_host"), table_name="pseo_hosts")
    op.drop_index(op.f("ix_pseo_hosts_tenant_id"), table_name="pseo_hosts")
    op.drop_table("pseo_hosts")

    op.drop_index(op.f("ix_pseo_pages_deleted"), table_name="pseo_pages")
    op.drop_index(op.f("ix_pseo_pages_published"), table_name="pseo_pages")
    op.drop_index(op.f("ix_pseo_pages_slug_path"), table_name="pseo_pages")
    op.drop_index(op.f("ix_pseo_pages_batch_id"), table_name="pseo_pages")
    op.drop_index(op.f("ix_pseo_pages_tenant_id"), table_name="pseo_pages")
    op.drop_table("pseo_pages")

    op.drop_index(op.f("ix_pseo_batches_deleted"), table_name="pseo_batches")
    op.drop_index(op.f("ix_pseo_batches_matrix_hash"), table_name="pseo_batches")
    op.drop_index(op.f("ix_pseo_batches_campaign_id"), table_name="pseo_batches")
    op.drop_index(op.f("ix_pseo_batches_tenant_id"), table_name="pseo_batches")
    op.drop_table("pseo_batches")
