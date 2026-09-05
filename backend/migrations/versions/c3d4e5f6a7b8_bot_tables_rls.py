"""bot_tables_rls

Fase 3 — tablas ``bot_company_providers``, ``bot_conversations``,
``bot_messages`` y ``bot_queue_meta`` con RLS.

- Crea las cuatro tablas de ejecución del bot con la tupla sync
  ``[revision, updated_at, deleted]``.
- ``bot_conversations.channel_id`` referencia ``tenant_channels.id`` y
  ``bot_messages.conversation_id`` referencia ``bot_conversations.id``.
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente). Sin esto, en prod las tablas quedarían
  sin RLS y expuestas a lectura cruzada entre tenants.
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE,
  idempotente) para mantener el mismo contrato de la tupla sync en prod.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = ("bot_company_providers", "bot_conversations", "bot_messages", "bot_queue_meta")


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _apply_rls(manager: RLSManager, table: str) -> None:
    op.execute(manager.enable_rls_sql(table))
    op.execute(manager.force_rls_sql(table))
    op.execute(manager.revoke_table_privileges_sql(table))
    op.execute(manager.tenant_isolation_policy_sql(table))


def upgrade() -> None:
    op.create_table(
        "bot_company_providers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("provider_kind", sa.String(length=16), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("temperature", sa.Numeric(precision=3, scale=2), nullable=True),
        sa.Column("api_key_ref", sa.Text(), nullable=False),
        sa.Column("prompt_base", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "provider_kind", "order", name="uq_bot_provider_kind_order"),
    )
    op.create_index(
        op.f("ix_bot_company_providers_tenant_id"), "bot_company_providers", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_company_providers_provider_kind"),
        "bot_company_providers",
        ["provider_kind"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_company_providers_deleted"), "bot_company_providers", ["deleted"], unique=False
    )

    op.create_table(
        "bot_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("external_contact_id", sa.String(length=255), nullable=False),
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["tenant_channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "channel_id", "external_contact_id", name="uq_bot_conversation_channel_contact"
        ),
    )
    op.create_index(
        op.f("ix_bot_conversations_tenant_id"), "bot_conversations", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_conversations_channel_id"), "bot_conversations", ["channel_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_conversations_external_contact_id"),
        "bot_conversations",
        ["external_contact_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_conversations_deleted"), "bot_conversations", ["deleted"], unique=False
    )

    op.create_table(
        "bot_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("provider_used", sa.String(length=32), nullable=True),
        sa.Column("tokens_used", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(length=128), nullable=True),
        sa.Column("queue_status", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["bot_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", name="uq_bot_messages_message_id"),
    )
    op.create_index(op.f("ix_bot_messages_tenant_id"), "bot_messages", ["tenant_id"], unique=False)
    op.create_index(
        op.f("ix_bot_messages_conversation_id"), "bot_messages", ["conversation_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_messages_direction"), "bot_messages", ["direction"], unique=False
    )
    op.create_index(
        op.f("ix_bot_messages_queue_status"), "bot_messages", ["queue_status"], unique=False
    )
    op.create_index(op.f("ix_bot_messages_deleted"), "bot_messages", ["deleted"], unique=False)

    op.create_table(
        "bot_queue_meta",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("stream", sa.String(length=255), nullable=False),
        sa.Column("last_processed_id", sa.String(length=128), nullable=True),
        sa.Column("dlq_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "stream", name="uq_bot_queue_meta_stream"),
    )
    op.create_index(op.f("ix_bot_queue_meta_tenant_id"), "bot_queue_meta", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_bot_queue_meta_deleted"), "bot_queue_meta", ["deleted"], unique=False)

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

    op.drop_index(op.f("ix_bot_queue_meta_deleted"), table_name="bot_queue_meta")
    op.drop_index(op.f("ix_bot_queue_meta_tenant_id"), table_name="bot_queue_meta")
    op.drop_table("bot_queue_meta")

    op.drop_index(op.f("ix_bot_messages_deleted"), table_name="bot_messages")
    op.drop_index(op.f("ix_bot_messages_queue_status"), table_name="bot_messages")
    op.drop_index(op.f("ix_bot_messages_direction"), table_name="bot_messages")
    op.drop_index(op.f("ix_bot_messages_conversation_id"), table_name="bot_messages")
    op.drop_index(op.f("ix_bot_messages_tenant_id"), table_name="bot_messages")
    op.drop_table("bot_messages")

    op.drop_index(op.f("ix_bot_conversations_deleted"), table_name="bot_conversations")
    op.drop_index(op.f("ix_bot_conversations_external_contact_id"), table_name="bot_conversations")
    op.drop_index(op.f("ix_bot_conversations_channel_id"), table_name="bot_conversations")
    op.drop_index(op.f("ix_bot_conversations_tenant_id"), table_name="bot_conversations")
    op.drop_table("bot_conversations")

    op.drop_index(op.f("ix_bot_company_providers_deleted"), table_name="bot_company_providers")
    op.drop_index(op.f("ix_bot_company_providers_provider_kind"), table_name="bot_company_providers")
    op.drop_index(op.f("ix_bot_company_providers_tenant_id"), table_name="bot_company_providers")
    op.drop_table("bot_company_providers")
