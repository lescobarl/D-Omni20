"""portal_look_columns

Añade las preferencias de look del portal de configuración (Studio) a la
apariencia del tenant: ``portal_accent`` (brand|neutral) y ``portal_surface``
(light|tint). Por tenant, aplicadas a todos los miembros y editables solo por
admin (endpoint dedicado con RBAC).

Revision ID: 4d5e6f7a8b9c
Revises: 3c4d5e6f7a8b
Create Date: 2026-09-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4d5e6f7a8b9c"
down_revision: str | None = "3c4d5e6f7a8b"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Añade las dos columnas con defaults no nulos (retrocompatible)."""
    op.add_column(
        "tenant_appearance",
        sa.Column(
            "portal_accent",
            sa.String(length=16),
            nullable=False,
            server_default="brand",
        ),
    )
    op.add_column(
        "tenant_appearance",
        sa.Column(
            "portal_surface",
            sa.String(length=16),
            nullable=False,
            server_default="light",
        ),
    )


def downgrade() -> None:
    """Elimina las columnas del look del portal."""
    op.drop_column("tenant_appearance", "portal_surface")
    op.drop_column("tenant_appearance", "portal_accent")
