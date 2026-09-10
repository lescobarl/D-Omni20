"""merge_heads

Consolida las 6 cabezas divergentes de migración en una sola para que
``alembic upgrade head`` vuelva a ser determinista (deuda detectada: seis
``revision`` sin descendencia común).

Revision ID: 3c4d5e6f7a8b
Revises: a2b3c4d5e6f7, 1a2b3c4d5e6f, a7b8c9d0e1f2, c1d2e3f4a5b6, f8a9b0c1d2e3, a0b1c2d3e4f5
Create Date: 2026-09-10
"""

from __future__ import annotations

# revision identifiers, used by Alembic.
revision: str = "3c4d5e6f7a8b"
down_revision: tuple[str, ...] | None = (
    "a2b3c4d5e6f7",
    "1a2b3c4d5e6f",
    "a7b8c9d0e1f2",
    "c1d2e3f4a5b6",
    "f8a9b0c1d2e3",
    "a0b1c2d3e4f5",
)
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Revisión de unión: no ejecuta DDL, solo consolida el grafo."""


def downgrade() -> None:
    """Reversión de la unión: no ejecuta DDL (las ramas vuelven a separarse)."""
