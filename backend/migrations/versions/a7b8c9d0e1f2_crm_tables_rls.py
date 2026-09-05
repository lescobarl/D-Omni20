"""crm_tables_rls

P1 — tablas ``crm_deals``, ``crm_deal_stages``, ``crm_deal_stage_changes``,
``crm_tasks`` y ``crm_sla_policies`` con RLS.

- Crea las cinco tablas del subsistema CRM (M1 pipeline, M2 tareas, M5 SLA)
  con la tupla sync ``[revision, updated_at, deleted]``.
- Relaciones cruzadas (M3 agregación Deal ↔ Lead ↔ Pago ↔ Cotización):
  - ``crm_deals.stage_id`` → ``crm_deal_stages.id`` (CASCADE).
  - ``crm_deals.contact_id`` → ``bot_contacts.id`` (SET NULL), creada en
    ``d4e5f6a7b8c9``.
  - ``crm_deals.lead_id`` → ``workflow_leads.id``, ``crm_deals.quote_id`` →
    ``workflow_quotes.id`` y ``crm_deals.payment_id`` →
    ``workflow_payments.id`` (SET NULL, tablas de workflows).
  - ``crm_deal_stage_changes.deal_id`` → ``crm_deals.id`` (CASCADE) e
    ``from_stage_id``/``to_stage_id`` → ``crm_deal_stages.id`` (SET NULL).
  - ``crm_tasks.deal_id`` → ``crm_deals.id`` (CASCADE) y
    ``crm_tasks.contact_id`` → ``bot_contacts.id`` (SET NULL).
  - ``crm_sla_policies.stage_id`` → ``crm_deal_stages.id`` (CASCADE).
- Unicidad: ``crm_deal_stages`` (tenant, name) y ``crm_sla_policies``
  (tenant, stage_id); el histórico ``crm_deal_stage_changes`` es append-only
  (un deal puede tener muchos registros).
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod las tablas
  quedarían sin RLS y expuestas a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente) para mantener el mismo contrato de la tupla sync en prod.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-08-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f6a7b8c9d0e1"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = (
    "crm_deals",
    "crm_deal_stages",
    "crm_deal_stage_changes",
    "crm_tasks",
    "crm_sla_policies",
)


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        "crm_deal_stages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("default_probability", sa.Integer(), nullable=False),
        sa.Column("is_terminal", sa.Boolean(), nullable=False),
        sa.Column("outcome", sa.String(length=8), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_crm_deal_stages_tenant_name"),
    )
    op.create_index(op.f("ix_crm_deal_stages_tenant_id"), "crm_deal_stages", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_crm_deal_stages_deleted"), "crm_deal_stages", ["deleted"], unique=False)

    op.create_table(
        "crm_deals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("stage_id", sa.Uuid(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("probability", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("contact_id", sa.Uuid(), nullable=True),
        sa.Column("lead_id", sa.Uuid(), nullable=True),
        sa.Column("quote_id", sa.Uuid(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("expected_close_at", sa.Date(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("won_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lost_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lost_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["crm_deal_stages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["bot_contacts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lead_id"], ["workflow_leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["quote_id"], ["workflow_quotes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["payment_id"], ["workflow_payments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_crm_deals_tenant_id"), "crm_deals", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_stage_id"), "crm_deals", ["stage_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_status"), "crm_deals", ["status"], unique=False)
    op.create_index(op.f("ix_crm_deals_contact_id"), "crm_deals", ["contact_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_lead_id"), "crm_deals", ["lead_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_quote_id"), "crm_deals", ["quote_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_payment_id"), "crm_deals", ["payment_id"], unique=False)
    op.create_index(op.f("ix_crm_deals_deleted"), "crm_deals", ["deleted"], unique=False)

    op.create_table(
        "crm_deal_stage_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("deal_id", sa.Uuid(), nullable=False),
        sa.Column("from_stage_id", sa.Uuid(), nullable=True),
        sa.Column("to_stage_id", sa.Uuid(), nullable=True),
        sa.Column("changed_by", sa.String(length=32), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deal_id"], ["crm_deals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_stage_id"], ["crm_deal_stages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["to_stage_id"], ["crm_deal_stages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_crm_deal_stage_changes_tenant_id"), "crm_deal_stage_changes", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_crm_deal_stage_changes_deal_id"), "crm_deal_stage_changes", ["deal_id"], unique=False
    )
    op.create_index(
        op.f("ix_crm_deal_stage_changes_from_stage_id"),
        "crm_deal_stage_changes",
        ["from_stage_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_crm_deal_stage_changes_to_stage_id"),
        "crm_deal_stage_changes",
        ["to_stage_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_crm_deal_stage_changes_deleted"), "crm_deal_stage_changes", ["deleted"], unique=False
    )

    op.create_table(
        "crm_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("deal_id", sa.Uuid(), nullable=True),
        sa.Column("contact_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("priority", sa.String(length=8), nullable=False),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deal_id"], ["crm_deals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["bot_contacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_crm_tasks_tenant_id"), "crm_tasks", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_crm_tasks_deal_id"), "crm_tasks", ["deal_id"], unique=False)
    op.create_index(op.f("ix_crm_tasks_contact_id"), "crm_tasks", ["contact_id"], unique=False)
    op.create_index(op.f("ix_crm_tasks_status"), "crm_tasks", ["status"], unique=False)
    op.create_index(op.f("ix_crm_tasks_deleted"), "crm_tasks", ["deleted"], unique=False)

    op.create_table(
        "crm_sla_policies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("stage_id", sa.Uuid(), nullable=False),
        sa.Column("max_response_hours", sa.Integer(), nullable=False),
        sa.Column("max_stay_days", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["crm_deal_stages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "stage_id", name="uq_crm_sla_policies_tenant_stage"),
    )
    op.create_index(op.f("ix_crm_sla_policies_tenant_id"), "crm_sla_policies", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_crm_sla_policies_stage_id"), "crm_sla_policies", ["stage_id"], unique=False)
    op.create_index(op.f("ix_crm_sla_policies_deleted"), "crm_sla_policies", ["deleted"], unique=False)

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

    op.drop_index(op.f("ix_crm_sla_policies_deleted"), table_name="crm_sla_policies")
    op.drop_index(op.f("ix_crm_sla_policies_stage_id"), table_name="crm_sla_policies")
    op.drop_index(op.f("ix_crm_sla_policies_tenant_id"), table_name="crm_sla_policies")
    op.drop_table("crm_sla_policies")

    op.drop_index(op.f("ix_crm_tasks_deleted"), table_name="crm_tasks")
    op.drop_index(op.f("ix_crm_tasks_status"), table_name="crm_tasks")
    op.drop_index(op.f("ix_crm_tasks_contact_id"), table_name="crm_tasks")
    op.drop_index(op.f("ix_crm_tasks_deal_id"), table_name="crm_tasks")
    op.drop_index(op.f("ix_crm_tasks_tenant_id"), table_name="crm_tasks")
    op.drop_table("crm_tasks")

    op.drop_index(
        op.f("ix_crm_deal_stage_changes_deleted"), table_name="crm_deal_stage_changes"
    )
    op.drop_index(
        op.f("ix_crm_deal_stage_changes_to_stage_id"), table_name="crm_deal_stage_changes"
    )
    op.drop_index(
        op.f("ix_crm_deal_stage_changes_from_stage_id"), table_name="crm_deal_stage_changes"
    )
    op.drop_index(
        op.f("ix_crm_deal_stage_changes_deal_id"), table_name="crm_deal_stage_changes"
    )
    op.drop_index(
        op.f("ix_crm_deal_stage_changes_tenant_id"), table_name="crm_deal_stage_changes"
    )
    op.drop_table("crm_deal_stage_changes")

    op.drop_index(op.f("ix_crm_deals_deleted"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_payment_id"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_quote_id"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_lead_id"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_contact_id"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_status"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_stage_id"), table_name="crm_deals")
    op.drop_index(op.f("ix_crm_deals_tenant_id"), table_name="crm_deals")
    op.drop_table("crm_deals")

    op.drop_index(op.f("ix_crm_deal_stages_deleted"), table_name="crm_deal_stages")
    op.drop_index(op.f("ix_crm_deal_stages_tenant_id"), table_name="crm_deal_stages")
    op.drop_table("crm_deal_stages")
