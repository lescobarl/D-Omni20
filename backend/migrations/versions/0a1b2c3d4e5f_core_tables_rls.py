"""core_tables_rls

Base del grafo de migraciones — tablas núcleo multi-tenant.

Crea las 14 tablas base que sustentan el resto del esquema y que hasta ahora
solo se materializaban vía ``Base.metadata.create_all`` en el arranque:

- ``tenants`` — raíz del multi-tenancy. Lleva tupla sync (revision, updated_at,
  deleted) pero SIN RLS ni trigger: es la tabla de bootstrap usada para resolver
  el slug ANTES de fijar ``app.current_tenant_id`` y nunca se actualiza vía
  repositorio (``ITenantRepository`` solo expone get_by_id/get_by_slug/create/
  list_all).
- ``audit_logs`` — log de auditoría append-only con ``tenant_id`` NULO y sin FK
  (lo escribe middleware en hilos de trabajo, antes de aislar por tenant); sin RLS.
- 12 tablas con alcance por tenant y RLS (PostgreSQL): oauth tokens, schemas,
  versiones, marketplace, analítica, landings, despliegues CDN y workflows.

En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
tenant_isolation_policy`` (idempotente) sobre las 12 tablas tenant-scoped, y
añade el trigger ``trg_<tabla>_bump_revision`` de incremento de ``revision``
en UPDATE sobre las 8 tablas con tupla sync, reutilizando la función compartida
``public.pseo_bump_sync_revision`` (CREATE OR REPLACE, idempotente).

``workflow_leads.ad_campaign_id`` NO se crea aquí: lo añade la migración
``f6a7b8c9d0e1`` junto con ``ad_campaigns``.

Revision ID: 0a1b2c3d4e5f
Revises:
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "0a1b2c3d4e5f"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None

# Tablas con aislamiento por tenant (RLS en PostgreSQL).
_RLS_TABLES = (
    "tenant_oauth_tokens",
    "developer_schemas",
    "schema_versions",
    "marketplace_templates",
    "analytics_events",
    "tenant_landings",
    "cdn_deployments",
    "workflow_payments",
    "workflow_leads",
    "workflow_quotes",
    "workflow_appointments",
    "workflow_appointment_reminders",
)

# Subconjunto con tupla sync: trigger de bump de ``revision`` en UPDATE.
_TRIGGER_TABLES = (
    "tenant_oauth_tokens",
    "developer_schemas",
    "tenant_landings",
    "workflow_payments",
    "workflow_leads",
    "workflow_quotes",
    "workflow_appointments",
    "workflow_appointment_reminders",
)


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    # --- 1. tenants (bootstrap: sin RLS ni trigger) ---
    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )
    op.create_index(op.f("ix_tenants_slug"), "tenants", ["slug"], unique=False)

    # --- 2. tenant_oauth_tokens (sync + RLS + trigger) ---
    op.create_table(
        "tenant_oauth_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("encrypted_access_token", sa.Text(), nullable=False),
        sa.Column("encrypted_refresh_token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "provider", name="uq_tenant_oauth_provider"),
    )
    op.create_index(
        op.f("ix_tenant_oauth_tokens_tenant_id"), "tenant_oauth_tokens", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_oauth_tokens_provider"), "tenant_oauth_tokens", ["provider"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_oauth_tokens_deleted"), "tenant_oauth_tokens", ["deleted"], unique=False
    )

    # --- 3. audit_logs (append-only, tenant_id NULO sin FK; sin RLS) ---
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("operation", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_tenant_id"), "audit_logs", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_audit_logs_request_id"), "audit_logs", ["request_id"], unique=False)
    op.create_index(op.f("ix_audit_logs_operation"), "audit_logs", ["operation"], unique=False)

    # --- 4. developer_schemas (sync + RLS + trigger) ---
    op.create_table(
        "developer_schemas",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("schema_json", sa.JSON(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_developer_schemas_tenant_id"), "developer_schemas", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_developer_schemas_deleted"), "developer_schemas", ["deleted"], unique=False
    )

    # --- 5. schema_versions (append-only + RLS) ---
    op.create_table(
        "schema_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("schema_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("schema_json", sa.JSON(), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["schema_id"], ["developer_schemas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_schema_versions_tenant_id"), "schema_versions", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_schema_versions_schema_id"), "schema_versions", ["schema_id"], unique=False
    )

    # --- 6. marketplace_templates (append-only + RLS) ---
    op.create_table(
        "marketplace_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=500), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("downloads", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_marketplace_templates_tenant_id"),
        "marketplace_templates",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_marketplace_templates_category"),
        "marketplace_templates",
        ["category"],
        unique=False,
    )

    # --- 7. analytics_events (append-only + RLS) ---
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_analytics_events_tenant_id"), "analytics_events", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_analytics_events_event_type"), "analytics_events", ["event_type"], unique=False
    )

    # --- 8. tenant_landings (sync + RLS + trigger) ---
    op.create_table(
        "tenant_landings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("compiled_html", sa.Text(), nullable=True),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "campaign_id", name="uq_tenant_landing_campaign"),
    )
    op.create_index(
        op.f("ix_tenant_landings_tenant_id"), "tenant_landings", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_tenant_landings_published"), "tenant_landings", ["published"], unique=False
    )
    op.create_index(op.f("ix_tenant_landings_deleted"), "tenant_landings", ["deleted"], unique=False)

    # --- 9. cdn_deployments (append-only + RLS) ---
    op.create_table(
        "cdn_deployments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("landing_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("html", sa.Text(), nullable=True),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["landing_id"], ["tenant_landings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_cdn_deployments_tenant_id"), "cdn_deployments", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_cdn_deployments_landing_id"), "cdn_deployments", ["landing_id"], unique=False
    )

    # --- 10. workflow_payments (sync + RLS + trigger) ---
    op.create_table(
        "workflow_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("provider_session_id", sa.String(length=255), nullable=True),
        sa.Column("customer_email", sa.String(length=255), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_payments_tenant_id"), "workflow_payments", ["tenant_id"], unique=False
    )
    op.create_index(op.f("ix_workflow_payments_status"), "workflow_payments", ["status"], unique=False)
    op.create_index(
        op.f("ix_workflow_payments_provider_session_id"),
        "workflow_payments",
        ["provider_session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_payments_deleted"), "workflow_payments", ["deleted"], unique=False
    )

    # --- 11. workflow_leads (sync + RLS + trigger; ad_campaign_id lo añade f6a7b8c9d0e1) ---
    op.create_table(
        "workflow_leads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workflow_leads_tenant_id"), "workflow_leads", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_workflow_leads_email"), "workflow_leads", ["email"], unique=False)
    op.create_index(op.f("ix_workflow_leads_status"), "workflow_leads", ["status"], unique=False)
    op.create_index(op.f("ix_workflow_leads_deleted"), "workflow_leads", ["deleted"], unique=False)

    # --- 12. workflow_quotes (sync + RLS + trigger) ---
    op.create_table(
        "workflow_quotes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=False),
        sa.Column("customer_email", sa.String(length=255), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("services", sa.JSON(), nullable=False),
        sa.Column("subtotal_minor", sa.Integer(), nullable=False),
        sa.Column("tax_minor", sa.Integer(), nullable=False),
        sa.Column("total_minor", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("pdf_path", sa.String(length=512), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_quotes_tenant_id"), "workflow_quotes", ["tenant_id"], unique=False
    )
    op.create_index(op.f("ix_workflow_quotes_status"), "workflow_quotes", ["status"], unique=False)
    op.create_index(op.f("ix_workflow_quotes_deleted"), "workflow_quotes", ["deleted"], unique=False)

    # --- 13. workflow_appointments (sync + RLS + trigger) ---
    op.create_table(
        "workflow_appointments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("service", sa.String(length=255), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=False),
        sa.Column("customer_email", sa.String(length=255), nullable=True),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("ics_path", sa.String(length=512), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_appointments_tenant_id"),
        "workflow_appointments",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointments_starts_at"),
        "workflow_appointments",
        ["starts_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointments_status"), "workflow_appointments", ["status"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_appointments_deleted"), "workflow_appointments", ["deleted"], unique=False
    )

    # --- 14. workflow_appointment_reminders (sync + RLS + trigger) ---
    op.create_table(
        "workflow_appointment_reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["appointment_id"], ["workflow_appointments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_appointment_reminders_tenant_id"),
        "workflow_appointment_reminders",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointment_reminders_appointment_id"),
        "workflow_appointment_reminders",
        ["appointment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointment_reminders_scheduled_at"),
        "workflow_appointment_reminders",
        ["scheduled_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointment_reminders_status"),
        "workflow_appointment_reminders",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_appointment_reminders_deleted"),
        "workflow_appointment_reminders",
        ["deleted"],
        unique=False,
    )

    if _is_postgresql():
        manager = RLSManager(schema="public")
        for table in _RLS_TABLES:
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

    op.drop_index(
        op.f("ix_workflow_appointment_reminders_deleted"),
        table_name="workflow_appointment_reminders",
    )
    op.drop_index(
        op.f("ix_workflow_appointment_reminders_status"),
        table_name="workflow_appointment_reminders",
    )
    op.drop_index(
        op.f("ix_workflow_appointment_reminders_scheduled_at"),
        table_name="workflow_appointment_reminders",
    )
    op.drop_index(
        op.f("ix_workflow_appointment_reminders_appointment_id"),
        table_name="workflow_appointment_reminders",
    )
    op.drop_index(
        op.f("ix_workflow_appointment_reminders_tenant_id"),
        table_name="workflow_appointment_reminders",
    )
    op.drop_table("workflow_appointment_reminders")

    op.drop_index(op.f("ix_workflow_appointments_deleted"), table_name="workflow_appointments")
    op.drop_index(op.f("ix_workflow_appointments_status"), table_name="workflow_appointments")
    op.drop_index(op.f("ix_workflow_appointments_starts_at"), table_name="workflow_appointments")
    op.drop_index(op.f("ix_workflow_appointments_tenant_id"), table_name="workflow_appointments")
    op.drop_table("workflow_appointments")

    op.drop_index(op.f("ix_workflow_quotes_deleted"), table_name="workflow_quotes")
    op.drop_index(op.f("ix_workflow_quotes_status"), table_name="workflow_quotes")
    op.drop_index(op.f("ix_workflow_quotes_tenant_id"), table_name="workflow_quotes")
    op.drop_table("workflow_quotes")

    op.drop_index(op.f("ix_workflow_leads_deleted"), table_name="workflow_leads")
    op.drop_index(op.f("ix_workflow_leads_status"), table_name="workflow_leads")
    op.drop_index(op.f("ix_workflow_leads_email"), table_name="workflow_leads")
    op.drop_index(op.f("ix_workflow_leads_tenant_id"), table_name="workflow_leads")
    op.drop_table("workflow_leads")

    op.drop_index(op.f("ix_workflow_payments_deleted"), table_name="workflow_payments")
    op.drop_index(
        op.f("ix_workflow_payments_provider_session_id"), table_name="workflow_payments"
    )
    op.drop_index(op.f("ix_workflow_payments_status"), table_name="workflow_payments")
    op.drop_index(op.f("ix_workflow_payments_tenant_id"), table_name="workflow_payments")
    op.drop_table("workflow_payments")

    op.drop_index(op.f("ix_cdn_deployments_landing_id"), table_name="cdn_deployments")
    op.drop_index(op.f("ix_cdn_deployments_tenant_id"), table_name="cdn_deployments")
    op.drop_table("cdn_deployments")

    op.drop_index(op.f("ix_tenant_landings_deleted"), table_name="tenant_landings")
    op.drop_index(op.f("ix_tenant_landings_published"), table_name="tenant_landings")
    op.drop_index(op.f("ix_tenant_landings_tenant_id"), table_name="tenant_landings")
    op.drop_table("tenant_landings")

    op.drop_index(op.f("ix_analytics_events_event_type"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_tenant_id"), table_name="analytics_events")
    op.drop_table("analytics_events")

    op.drop_index(op.f("ix_marketplace_templates_category"), table_name="marketplace_templates")
    op.drop_index(op.f("ix_marketplace_templates_tenant_id"), table_name="marketplace_templates")
    op.drop_table("marketplace_templates")

    op.drop_index(op.f("ix_schema_versions_schema_id"), table_name="schema_versions")
    op.drop_index(op.f("ix_schema_versions_tenant_id"), table_name="schema_versions")
    op.drop_table("schema_versions")

    op.drop_index(op.f("ix_developer_schemas_deleted"), table_name="developer_schemas")
    op.drop_index(op.f("ix_developer_schemas_tenant_id"), table_name="developer_schemas")
    op.drop_table("developer_schemas")

    op.drop_index(op.f("ix_audit_logs_operation"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_request_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_tenant_id"), table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index(op.f("ix_tenant_oauth_tokens_deleted"), table_name="tenant_oauth_tokens")
    op.drop_index(op.f("ix_tenant_oauth_tokens_provider"), table_name="tenant_oauth_tokens")
    op.drop_index(op.f("ix_tenant_oauth_tokens_tenant_id"), table_name="tenant_oauth_tokens")
    op.drop_table("tenant_oauth_tokens")

    op.drop_index(op.f("ix_tenants_slug"), table_name="tenants")
    op.drop_table("tenants")
