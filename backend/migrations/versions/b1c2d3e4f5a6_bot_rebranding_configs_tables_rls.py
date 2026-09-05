"""bot_rebranding_configs_tables_rls

Fase 5 — Rebranding por URL.

Crea ``bot_rebranding_configs``: cada fila asocia un ``name`` y una ``url``
(origen de la marca, único por tenant) con el JSON ``extracted`` resultante de
analizar los estilos de esa URL (paleta, tipografías y logo). ``applied_at``
registra cuándo la configuración se aplicó a la apariencia del tenant.

Reglas CLAUDE aplicadas: UUIDv4, tupla sync ``[revision, updated_at, deleted]``,
soft-delete y aislamiento multi-tenant por ``tenant_id``.

- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente).
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE).

Revision ID: b1c2d3e4f5a6
Revises: f0e1d2c3b4a5
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "f0e1d2c3b4a5"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = (
    "bot_rebranding_configs",
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
        "bot_rebranding_configs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("extracted", sa.JSON(), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "url", name="uq_bot_rebranding_configs_tenant_url"
        ),
    )
    op.create_index(
        op.f("ix_bot_rebranding_configs_tenant_id"),
        "bot_rebranding_configs",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_rebranding_configs_url"),
        "bot_rebranding_configs",
        ["url"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_rebranding_configs_deleted"),
        "bot_rebranding_configs",
        ["deleted"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_rebranding_configs_tenant_applied_at"),
        "bot_rebranding_configs",
        ["tenant_id", "applied_at"],
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
    if _is_postgresql():
        for table in _TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_bump_revision ON public.{table};")

    op.drop_index(
        op.f("ix_bot_rebranding_configs_tenant_applied_at"),
        table_name="bot_rebranding_configs",
    )
    op.drop_index(op.f("ix_bot_rebranding_configs_deleted"), table_name="bot_rebranding_configs")
    op.drop_index(op.f("ix_bot_rebranding_configs_url"), table_name="bot_rebranding_configs")
    op.drop_index(
        op.f("ix_bot_rebranding_configs_tenant_id"),
        table_name="bot_rebranding_configs",
    )
    op.drop_table("bot_rebranding_configs")
