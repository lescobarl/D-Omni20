"""operations_tables_rls

P0 — tablas ``bot_contacts``, ``bot_templates``, ``bot_navigation_trees``,
``bot_campaigns``, ``bot_campaign_recipients``, ``bot_interventions`` y
``bot_maintenance_config`` con RLS.

- Crea las siete tablas de operación del bot (Bloque B de LAE Omni2.0) con la
  tupla sync ``[revision, updated_at, deleted]``.
- Relaciones cruzadas:
  - ``bot_campaigns.template_id`` → ``bot_templates.id`` (ON DELETE SET NULL).
  - ``bot_campaign_recipients.campaign_id`` → ``bot_campaigns.id`` (CASCADE) y
    ``bot_campaign_recipients.contact_id`` → ``bot_contacts.id`` (CASCADE).
  - ``bot_interventions.conversation_id`` → ``bot_conversations.id`` (CASCADE,
    tabla creada en la migración ``c3d4e5f6a7b8``).
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod las tablas quedarían
  sin RLS y expuestas a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente) para mantener el mismo contrato de la tupla sync en prod.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = (
    "bot_contacts",
    "bot_templates",
    "bot_navigation_trees",
    "bot_campaigns",
    "bot_campaign_recipients",
    "bot_interventions",
    "bot_maintenance_config",
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
        "bot_contacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("external_contact_id", sa.String(length=255), nullable=True),
        sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "phone", name="uq_bot_contacts_tenant_phone"),
    )
    op.create_index(op.f("ix_bot_contacts_tenant_id"), "bot_contacts", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_bot_contacts_phone"), "bot_contacts", ["phone"], unique=False)
    op.create_index(op.f("ix_bot_contacts_state"), "bot_contacts", ["state"], unique=False)
    op.create_index(
        op.f("ix_bot_contacts_external_contact_id"), "bot_contacts", ["external_contact_id"], unique=False
    )
    op.create_index(op.f("ix_bot_contacts_deleted"), "bot_contacts", ["deleted"], unique=False)

    op.create_table(
        "bot_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("template_type", sa.String(length=32), nullable=False),
        sa.Column("variables", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_bot_templates_tenant_name"),
    )
    op.create_index(op.f("ix_bot_templates_tenant_id"), "bot_templates", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_bot_templates_name"), "bot_templates", ["name"], unique=False)
    op.create_index(op.f("ix_bot_templates_deleted"), "bot_templates", ["deleted"], unique=False)

    op.create_table(
        "bot_navigation_trees",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("num_options", sa.Integer(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_bot_navigation_trees_tenant_name"),
    )
    op.create_index(
        op.f("ix_bot_navigation_trees_tenant_id"), "bot_navigation_trees", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_navigation_trees_name"), "bot_navigation_trees", ["name"], unique=False
    )
    op.create_index(
        op.f("ix_bot_navigation_trees_deleted"), "bot_navigation_trees", ["deleted"], unique=False
    )

    op.create_table(
        "bot_campaigns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("schedule", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["bot_templates.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bot_campaigns_tenant_id"), "bot_campaigns", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_bot_campaigns_name"), "bot_campaigns", ["name"], unique=False)
    op.create_index(
        op.f("ix_bot_campaigns_template_id"), "bot_campaigns", ["template_id"], unique=False
    )
    op.create_index(op.f("ix_bot_campaigns_state"), "bot_campaigns", ["state"], unique=False)
    op.create_index(op.f("ix_bot_campaigns_deleted"), "bot_campaigns", ["deleted"], unique=False)

    op.create_table(
        "bot_campaign_recipients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("contact_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("result", sa.String(length=255), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_id"], ["bot_campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["bot_contacts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "contact_id", name="uq_bot_campaign_recipients_campaign_contact"),
    )
    op.create_index(
        op.f("ix_bot_campaign_recipients_tenant_id"),
        "bot_campaign_recipients",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_campaign_recipients_campaign_id"),
        "bot_campaign_recipients",
        ["campaign_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_campaign_recipients_contact_id"),
        "bot_campaign_recipients",
        ["contact_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_campaign_recipients_state"),
        "bot_campaign_recipients",
        ["state"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_campaign_recipients_deleted"),
        "bot_campaign_recipients",
        ["deleted"],
        unique=False,
    )

    op.create_table(
        "bot_interventions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("operator", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["bot_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_bot_interventions_tenant_id"), "bot_interventions", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_interventions_conversation_id"),
        "bot_interventions",
        ["conversation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_interventions_state"), "bot_interventions", ["state"], unique=False
    )
    op.create_index(
        op.f("ix_bot_interventions_deleted"), "bot_interventions", ["deleted"], unique=False
    )

    op.create_table(
        "bot_maintenance_config",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("retention_rules", sa.JSON(), nullable=False),
        sa.Column("maintenance_schedule", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_bot_maintenance_config_tenant"),
    )
    op.create_index(
        op.f("ix_bot_maintenance_config_tenant_id"),
        "bot_maintenance_config",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_maintenance_config_deleted"),
        "bot_maintenance_config",
        ["deleted"],
        unique=False,
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

    op.drop_index(
        op.f("ix_bot_maintenance_config_deleted"), table_name="bot_maintenance_config"
    )
    op.drop_index(
        op.f("ix_bot_maintenance_config_tenant_id"), table_name="bot_maintenance_config"
    )
    op.drop_table("bot_maintenance_config")

    op.drop_index(op.f("ix_bot_interventions_deleted"), table_name="bot_interventions")
    op.drop_index(op.f("ix_bot_interventions_state"), table_name="bot_interventions")
    op.drop_index(
        op.f("ix_bot_interventions_conversation_id"), table_name="bot_interventions"
    )
    op.drop_index(op.f("ix_bot_interventions_tenant_id"), table_name="bot_interventions")
    op.drop_table("bot_interventions")

    op.drop_index(
        op.f("ix_bot_campaign_recipients_deleted"), table_name="bot_campaign_recipients"
    )
    op.drop_index(
        op.f("ix_bot_campaign_recipients_state"), table_name="bot_campaign_recipients"
    )
    op.drop_index(
        op.f("ix_bot_campaign_recipients_contact_id"), table_name="bot_campaign_recipients"
    )
    op.drop_index(
        op.f("ix_bot_campaign_recipients_campaign_id"), table_name="bot_campaign_recipients"
    )
    op.drop_index(
        op.f("ix_bot_campaign_recipients_tenant_id"), table_name="bot_campaign_recipients"
    )
    op.drop_table("bot_campaign_recipients")

    op.drop_index(op.f("ix_bot_campaigns_deleted"), table_name="bot_campaigns")
    op.drop_index(op.f("ix_bot_campaigns_state"), table_name="bot_campaigns")
    op.drop_index(op.f("ix_bot_campaigns_template_id"), table_name="bot_campaigns")
    op.drop_index(op.f("ix_bot_campaigns_name"), table_name="bot_campaigns")
    op.drop_index(op.f("ix_bot_campaigns_tenant_id"), table_name="bot_campaigns")
    op.drop_table("bot_campaigns")

    op.drop_index(op.f("ix_bot_navigation_trees_deleted"), table_name="bot_navigation_trees")
    op.drop_index(op.f("ix_bot_navigation_trees_name"), table_name="bot_navigation_trees")
    op.drop_index(
        op.f("ix_bot_navigation_trees_tenant_id"), table_name="bot_navigation_trees"
    )
    op.drop_table("bot_navigation_trees")

    op.drop_index(op.f("ix_bot_templates_deleted"), table_name="bot_templates")
    op.drop_index(op.f("ix_bot_templates_name"), table_name="bot_templates")
    op.drop_index(op.f("ix_bot_templates_tenant_id"), table_name="bot_templates")
    op.drop_table("bot_templates")

    op.drop_index(op.f("ix_bot_contacts_deleted"), table_name="bot_contacts")
    op.drop_index(
        op.f("ix_bot_contacts_external_contact_id"), table_name="bot_contacts"
    )
    op.drop_index(op.f("ix_bot_contacts_state"), table_name="bot_contacts")
    op.drop_index(op.f("ix_bot_contacts_phone"), table_name="bot_contacts")
    op.drop_index(op.f("ix_bot_contacts_tenant_id"), table_name="bot_contacts")
    op.drop_table("bot_contacts")
