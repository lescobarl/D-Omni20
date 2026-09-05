"""recipient_files_tables_rls

P0 — tabla ``bot_campaign_recipient_files`` con RLS.

- Crea la tabla de archivos de destinatarios reutilizables (GAP 2 · envío masivo
  sobre archivos existentes) con la tupla sync ``[revision, updated_at, deleted]``.
- Relación cruzada: ``bot_campaign_recipient_files.tenant_id`` → ``tenants.id``
  (CASCADE).
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod la tabla quedaría
  sin RLS y expuesta a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente) para mantener el mismo contrato de la tupla sync en prod.

Revision ID: a2b3c4d5e6f7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "bot_campaign_recipient_files"


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
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("raw_csv", sa.Text(), nullable=False),
        sa.Column("source_meta", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_bot_campaign_recipient_files_tenant_id"), _TABLE, ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_campaign_recipient_files_name"), _TABLE, ["name"], unique=False
    )
    op.create_index(
        op.f("ix_bot_campaign_recipient_files_deleted"), _TABLE, ["deleted"], unique=False
    )

    if _is_postgresql():
        manager = RLSManager(schema="public")
        _apply_rls(manager, _TABLE)
        op.execute(
            """
            CREATE OR REPLACE FUNCTION public.pseo_bump_sync_revision()
            RETURNS trigger AS $$
            BEGIN
                NEW.revision := COALESCE(OLD.revision, 0) + 1;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            f"""
            CREATE TRIGGER trg_{_TABLE}_bump_revision
            BEFORE UPDATE ON public.{_TABLE}
            FOR EACH ROW EXECUTE FUNCTION public.pseo_bump_sync_revision();
            """
        )


def downgrade() -> None:
    if _is_postgresql():
        op.execute(f"DROP TRIGGER IF EXISTS trg_{_TABLE}_bump_revision ON public.{_TABLE};")

    op.drop_index(op.f("ix_bot_campaign_recipient_files_deleted"), table_name=_TABLE)
    op.drop_index(op.f("ix_bot_campaign_recipient_files_name"), table_name=_TABLE)
    op.drop_index(op.f("ix_bot_campaign_recipient_files_tenant_id"), table_name=_TABLE)
    op.drop_table(_TABLE)
