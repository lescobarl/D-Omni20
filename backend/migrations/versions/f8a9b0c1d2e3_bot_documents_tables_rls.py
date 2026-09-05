"""bot_documents_tables_rls

Fase 1 — Ingesta de base de conocimiento (RAG).

Crea ``bot_documents`` (fuentes PDF/TXT/CSV/URL) y ``bot_document_chunks``
(fragmentos para búsqueda granular) con la tupla sync ``[revision,
updated_at, deleted]`` y aislamiento multi-tenant.

- ``bot_documents.metadata`` es un JSON con metadatos del origen (p. ej. filas
  de un CSV, encoding detectado o número de páginas de un PDF).
- ``bot_document_chunks.document_id`` → ``bot_documents.id`` (CASCADE) con
  ``ordinal`` para preservar el orden de los fragmentos.
- En PostgreSQL emite vía :class:`RLSManager`: ``ENABLE``/``FORCE ROW LEVEL
  SECURITY``, ``REVOKE ALL ... FROM PUBLIC`` y ``CREATE POLICY
  tenant_isolation_policy`` (idempotente).
- Añade el trigger de incremento de ``revision`` en UPDATE (PostgreSQL),
  reutilizando la función ``pseo_bump_sync_revision`` (CREATE OR REPLACE).

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.core.rls import RLSManager

# revision identifiers, used by Alembic.
revision: str = "f8a9b0c1d2e3"
down_revision: str | None = "f7a8b9c0d1e2"
branch_labels: str | None = None
depends_on: str | None = None

_TABLES = (
    "bot_documents",
    "bot_document_chunks",
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
        "bot_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_ref", sa.String(length=512), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bot_documents_tenant_id"), "bot_documents", ["tenant_id"], unique=False)
    op.create_index(
        op.f("ix_bot_documents_source_type"), "bot_documents", ["source_type"], unique=False
    )
    op.create_index(op.f("ix_bot_documents_deleted"), "bot_documents", ["deleted"], unique=False)

    op.create_table(
        "bot_document_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["bot_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "ordinal", name="uq_bot_document_chunks_document_ordinal"),
    )
    op.create_index(
        op.f("ix_bot_document_chunks_tenant_id"), "bot_document_chunks", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_bot_document_chunks_document_id"),
        "bot_document_chunks",
        ["document_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_bot_document_chunks_deleted"), "bot_document_chunks", ["deleted"], unique=False
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
        op.f("ix_bot_document_chunks_deleted"), table_name="bot_document_chunks"
    )
    op.drop_index(
        op.f("ix_bot_document_chunks_document_id"), table_name="bot_document_chunks"
    )
    op.drop_index(
        op.f("ix_bot_document_chunks_tenant_id"), table_name="bot_document_chunks"
    )
    op.drop_table("bot_document_chunks")

    op.drop_index(op.f("ix_bot_documents_deleted"), table_name="bot_documents")
    op.drop_index(op.f("ix_bot_documents_source_type"), table_name="bot_documents")
    op.drop_index(op.f("ix_bot_documents_tenant_id"), table_name="bot_documents")
    op.drop_table("bot_documents")
