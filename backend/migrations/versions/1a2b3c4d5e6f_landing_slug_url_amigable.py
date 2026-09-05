"""landing_slug_url_amigable

Añade la columna ``slug`` a ``tenant_landings`` para dar a cada landing una URL
amigable única dentro del tenant (p. ej. ``casa-vista-lago-tequesquitengo``),
servida en ``GET /l/{slug}``.

- Añade la columna ``slug`` (nullable) a ``tenant_landings``.
- Rellena (backfill) las filas existentes con un slug derivado del ``name``
  (minúsculas, no alfanuméricos → guiones, sin guiones iniciales/finales).
  Si el nombre no produce un slug válido, usa ``landing-{id}`` para garantizar
  unicidad.
- Hace la columna ``NOT NULL``.
- Crea el índice ``ix_tenant_landings_slug`` y la constraint única
  ``uq_tenant_landing_slug`` sobre ``(tenant_id, slug)``.

Revision ID: 1a2b3c4d5e6f
Revises: 068511c26fcc
Create Date: 2026-09-01
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1a2b3c4d5e6f"
down_revision: str | None = "068511c26fcc"
branch_labels: str | None = None
depends_on: str | None = None


def _slugify(value: str) -> str:
    """Normaliza un texto a slug URL amigable (minúsculas, guiones)."""
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or ""


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    # 1. Añadir la columna nullable.
    op.add_column(
        "tenant_landings",
        sa.Column("slug", sa.String(length=255), nullable=True),
    )

    # 2. Backfill: derivar el slug del nombre (o de un fallback único por id).
    table = sa.table(
        "tenant_landings",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
    )
    rows = bind.execute(sa.select(table.c.id, table.c.name)).mappings().all()
    for row in rows:
        slug = _slugify(row["name"] or "")
        if not slug:
            slug = f"landing-{row['id']}"
        bind.execute(
            table.update().where(table.c.id == row["id"]).values(slug=slug)
        )

    if is_postgresql:
        # 3. PostgreSQL: ALTER COLUMN + índice + constraint única directos.
        op.alter_column("tenant_landings", "slug", nullable=False)
        op.create_index(
            op.f("ix_tenant_landings_slug"),
            "tenant_landings",
            ["slug"],
            unique=False,
        )
        op.create_unique_constraint(
            "uq_tenant_landing_slug", "tenant_landings", ["tenant_id", "slug"]
        )
    else:
        # 3. SQLite: no soporta ALTER COLUMN para NOT NULL; se reconstruye la
        #    tabla con batch_alter_table (nullable=False + índice + constraint).
        with op.batch_alter_table("tenant_landings") as batch_op:
            batch_op.alter_column("slug", existing_type=sa.String(length=255), nullable=False)
            batch_op.create_index(
                op.f("ix_tenant_landings_slug"), ["slug"], unique=False
            )
            batch_op.create_unique_constraint(
                "uq_tenant_landing_slug", ["tenant_id", "slug"]
            )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        op.drop_constraint("uq_tenant_landing_slug", "tenant_landings", type_="unique")
        op.drop_index(op.f("ix_tenant_landings_slug"), table_name="tenant_landings")
        op.drop_column("tenant_landings", "slug")
    else:
        with op.batch_alter_table("tenant_landings") as batch_op:
            batch_op.drop_constraint("uq_tenant_landing_slug", type_="unique")
            batch_op.drop_index(op.f("ix_tenant_landings_slug"))
            batch_op.drop_column("slug")
