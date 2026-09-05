"""portal_pages_rls

P0 — tabla ``portal_pages`` (páginas del Portal del Cliente) con RLS.

- Crea la tabla ``portal_pages`` con la tupla sync ``[revision, updated_at,
  deleted]`` y el mixin tenant-scoped.
- ``portal_pages.slug`` es único por tenant (``uq_portal_page_tenant_slug``).
- ``portal_pages.blocks`` almacena la configuración de bloques del portal
  (JSON) generada por IA o editada manualmente en el configurador.
- ``portal_pages.compiled_html`` guarda el HTML compilado (opcional).
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente).
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente).

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-09-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "portal_pages"


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("blocks", sa.JSON(), nullable=False),
        sa.Column("compiled_html", sa.Text(), nullable=True),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_portal_page_tenant_slug"),
    )
    op.create_index(op.f("ix_portal_pages_tenant_id"), _TABLE, ["tenant_id"], unique=False)
    op.create_index(op.f("ix_portal_pages_slug"), _TABLE, ["slug"], unique=False)
    op.create_index(op.f("ix_portal_pages_published"), _TABLE, ["published"], unique=False)
    op.create_index(op.f("ix_portal_pages_deleted"), _TABLE, ["deleted"], unique=False)

    if _is_postgresql():
        manager = RLSManager(schema="public")
        _apply_rls(manager, _TABLE)

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
        op.execute(
            f"CREATE TRIGGER trg_{_TABLE}_bump_revision "
            f"BEFORE UPDATE ON public.{_TABLE} "
            f"FOR EACH ROW EXECUTE FUNCTION public.pseo_bump_sync_revision();"
        )


def downgrade() -> None:
    if _is_postgresql():
        op.execute(f"DROP TRIGGER IF EXISTS trg_{_TABLE}_bump_revision ON public.{_TABLE};")

    op.drop_index(op.f("ix_portal_pages_deleted"), table_name=_TABLE)
    op.drop_index(op.f("ix_portal_pages_published"), table_name=_TABLE)
    op.drop_index(op.f("ix_portal_pages_slug"), table_name=_TABLE)
    op.drop_index(op.f("ix_portal_pages_tenant_id"), table_name=_TABLE)
    op.drop_table(_TABLE)
