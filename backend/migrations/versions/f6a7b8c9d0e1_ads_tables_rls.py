"""ads_tables_rls

C-1 — Captación (eslabón ①): tabla ``ad_campaigns`` con RLS y atribución UTM.

- Crea la tabla ``ad_campaigns`` con la tupla sync ``[revision, updated_at,
  deleted]``, los cinco parámetros UTM, la landing de destino (FK →
  ``tenant_landings.id`` SET NULL) y el presupuesto (minor units).
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente), además del trigger de incremento de
  ``revision`` en UPDATE reutilizando ``public.pseo_bump_sync_revision``.
- Añade ``ad_campaign_id`` (FK → ``ad_campaigns.id`` SET NULL) a ``workflow_leads``
  y ``bot_conversations`` para la cadena de atribución lead→conversación→campaña.
  Las columnas heredan las políticas RLS existentes de sus tablas (como en
  ``e5f6a7b8c9d0``).

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-08-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = ("ad_campaigns",)


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        "ad_campaigns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("utm_source", sa.String(length=255), nullable=True),
        sa.Column("utm_medium", sa.String(length=255), nullable=True),
        sa.Column("utm_campaign", sa.String(length=255), nullable=True),
        sa.Column("utm_content", sa.String(length=255), nullable=True),
        sa.Column("utm_term", sa.String(length=255), nullable=True),
        sa.Column("landing_id", sa.Uuid(), nullable=True),
        sa.Column("budget_minor", sa.Integer(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["landing_id"], ["tenant_landings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_ad_campaigns_tenant_name"),
    )
    op.create_index(op.f("ix_ad_campaigns_tenant_id"), "ad_campaigns", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_ad_campaigns_status"), "ad_campaigns", ["status"], unique=False)
    op.create_index(op.f("ix_ad_campaigns_enabled"), "ad_campaigns", ["enabled"], unique=False)
    op.create_index(op.f("ix_ad_campaigns_utm_campaign"), "ad_campaigns", ["utm_campaign"], unique=False)
    op.create_index(op.f("ix_ad_campaigns_landing_id"), "ad_campaigns", ["landing_id"], unique=False)
    op.create_index(op.f("ix_ad_campaigns_deleted"), "ad_campaigns", ["deleted"], unique=False)

    # Atribución: workflow_leads.ad_campaign_id (captación vía formulario UTM).
    # La columna (nullable) y su índice se crean en ambos dialectos; la FK solo
    # en PostgreSQL (SQLite no soporta ALTER TABLE ADD CONSTRAINT).
    op.add_column("workflow_leads", sa.Column("ad_campaign_id", sa.Uuid(), nullable=True))
    if _is_postgresql():
        op.create_foreign_key(
            "fk_workflow_leads_ad_campaign",
            "workflow_leads",
            "ad_campaigns",
            ["ad_campaign_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        op.f("ix_workflow_leads_ad_campaign_id"), "workflow_leads", ["ad_campaign_id"], unique=False
    )

    # Atribución: bot_conversations.ad_campaign_id (conversación → campaña).
    op.add_column("bot_conversations", sa.Column("ad_campaign_id", sa.Uuid(), nullable=True))
    if _is_postgresql():
        op.create_foreign_key(
            "fk_bot_conversations_ad_campaign",
            "bot_conversations",
            "ad_campaigns",
            ["ad_campaign_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        op.f("ix_bot_conversations_ad_campaign_id"),
        "bot_conversations",
        ["ad_campaign_id"],
        unique=False,
    )

    if _is_postgresql():
        manager = RLSManager(schema="public")
        for table in _TABLES:
            _apply_rls(manager, table)

        # Trigger de incremento de ``revision`` en UPDATE (tupla sync en prod).
        # CREATE OR REPLACE: idempotente y compartido con las migraciones previas.
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
    op.drop_index(op.f("ix_bot_conversations_ad_campaign_id"), table_name="bot_conversations")
    if _is_postgresql():
        op.drop_constraint("fk_bot_conversations_ad_campaign", "bot_conversations", type_="foreignkey")
    op.drop_column("bot_conversations", "ad_campaign_id")

    op.drop_index(op.f("ix_workflow_leads_ad_campaign_id"), table_name="workflow_leads")
    if _is_postgresql():
        op.drop_constraint("fk_workflow_leads_ad_campaign", "workflow_leads", type_="foreignkey")
    op.drop_column("workflow_leads", "ad_campaign_id")

    if _is_postgresql():
        for table in _TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_bump_revision ON public.{table};")

    op.drop_index(op.f("ix_ad_campaigns_deleted"), table_name="ad_campaigns")
    op.drop_index(op.f("ix_ad_campaigns_landing_id"), table_name="ad_campaigns")
    op.drop_index(op.f("ix_ad_campaigns_utm_campaign"), table_name="ad_campaigns")
    op.drop_index(op.f("ix_ad_campaigns_enabled"), table_name="ad_campaigns")
    op.drop_index(op.f("ix_ad_campaigns_status"), table_name="ad_campaigns")
    op.drop_index(op.f("ix_ad_campaigns_tenant_id"), table_name="ad_campaigns")
    op.drop_table("ad_campaigns")
