"""campaigns_landing_link

C-2 — Recompra / Postventa / Recuperación (eslabones ⑦⑧⑨): vincula la campaña
de recompra a la landing/pasarela que la origina (GAP-12 / F.4.1).

- Añade ``bot_campaigns.landing_id`` (FK → ``tenant_landings.id`` SET NULL,
  nullable) para que una campaña de recompra pueda apuntar a la landing/pasarela
  de la que provienen sus contactos.
- La columna (nullable) y su índice se crean en ambos dialectos; la FK solo en
  PostgreSQL (SQLite no soporta ALTER TABLE ADD CONSTRAINT), replicando el
  patrón de ``f6a7b8c9d0e1`` para ``ad_campaigns.landing_id``.

No requiere RLS adicional: el RLS es a nivel de tabla (``d4e5f6a7b8c9``) y la
nueva columna hereda la política ``tenant_isolation_policy`` existente. Tampoco
requiere trigger de ``revision``: es un añadido de columnas.

Esta migración además consolida las tres cabezas previas del grafo de
migraciones (``1a2b3c4d5e6f``, ``a2b3c4d5e6f7`` y ``c1d2e3f4a5b6``) en una
única cabeza.

Revision ID: c9d0e1f2a3b4
Revises: 1a2b3c4d5e6f, a2b3c4d5e6f7, c1d2e3f4a5b6
Create Date: 2026-09-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: str | Sequence[str] | None = ("1a2b3c4d5e6f", "a2b3c4d5e6f7", "c1d2e3f4a5b6")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "bot_campaigns"


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("landing_id", sa.Uuid(), nullable=True))
    if _is_postgresql():
        op.create_foreign_key(
            "fk_bot_campaigns_landing",
            _TABLE,
            "tenant_landings",
            ["landing_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        op.f("ix_bot_campaigns_landing_id"), _TABLE, ["landing_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_bot_campaigns_landing_id"), table_name=_TABLE)
    if _is_postgresql():
        op.drop_constraint("fk_bot_campaigns_landing", _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "landing_id")
