"""pseo_hosts_status

Dominios personalizados: ciclo de vida del mapeo ``pseo_hosts``.

- Añade ``status`` (String(16), NOT NULL, default ``"pending"``): estados
  ``pending`` | ``active``. Solo los hosts ``active`` (y no eliminados) son
  servidos públicamente por ``GET /pseo/{slug_path}``.
- Añade ``verify_token`` (String(128), NULL): token TXT de verificación de
  propiedad DNS (``_omni2-verify.{host}``).
- Añade ``verified_at`` (DateTime(timezone=True), NULL): marca de tiempo de la
  verificación DNS exitosa (no se auto-rellena; solo se fija en verificación).
- Crea el índice ``ix_pseo_hosts_status``.

No hay cambios RLS: las columnas se añaden a la tabla ``pseo_hosts`` que ya
tiene RLS habilitado (``a1b2c3d4e5f6``) y la política existente cubre las
columnas nuevas.

Revision ID: f7a8b9c0d1e2
Revises: f6a7b8c9d0e1
Create Date: 2026-08-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "f6a7b8c9d0e1"
branch_labels: str | None = None
depends_on: str | None = None


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    op.add_column(
        "pseo_hosts",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
    )
    op.add_column(
        "pseo_hosts",
        sa.Column("verify_token", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "pseo_hosts",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f("ix_pseo_hosts_status"), "pseo_hosts", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_pseo_hosts_status"), table_name="pseo_hosts")
    op.drop_column("pseo_hosts", "verified_at")
    op.drop_column("pseo_hosts", "verify_token")
    op.drop_column("pseo_hosts", "status")
