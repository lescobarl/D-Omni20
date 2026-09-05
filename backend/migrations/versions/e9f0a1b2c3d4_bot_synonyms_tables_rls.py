"""bot_synonyms_tables_rls

Fase 2 — Sinónimos del bot (normalización de vocabulario).

Crea ``bot_synonyms``: cada fila asocia un ``term`` canónico con una lista de
``synonyms`` (JSON array). Un mismo término solo puede existir una vez por
tenant (unique ``(tenant_id, term)``), lo que permite normalizar la entrada del
usuario antes de resolver la intención (Fases 3-4).

Reglas CLAUDE aplicadas: UUIDv4, tupla sync ``[revision, updated_at, deleted]``,
soft-delete y aislamiento multi-tenant por ``tenant_id``.

- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente).
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE).

Revision ID: e9f0a1b2c3d4
Revises: 068511c26fcc
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d4"
down_revision: str | None = "068511c26fcc"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = (
    "bot_synonyms",
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
        "bot_synonyms",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("term", sa.String(length=255), nullable=False),
        sa.Column("synonyms", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "term", name="uq_bot_synonyms_tenant_term"),
    )
    op.create_index(op.f("ix_bot_synonyms_tenant_id"), "bot_synonyms", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_bot_synonyms_term"), "bot_synonyms", ["term"], unique=False)
    op.create_index(op.f("ix_bot_synonyms_deleted"), "bot_synonyms", ["deleted"], unique=False)

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

    op.drop_index(op.f("ix_bot_synonyms_deleted"), table_name="bot_synonyms")
    op.drop_index(op.f("ix_bot_synonyms_term"), table_name="bot_synonyms")
    op.drop_index(op.f("ix_bot_synonyms_tenant_id"), table_name="bot_synonyms")
    op.drop_table("bot_synonyms")
