"""campaigns_segmentacion_disparo

C-2 — Recompra / Postventa / Recuperación (eslabones ⑦⑧⑨): amplía
``bot_campaigns`` con segmentación y disparo.

- ``segment_type`` ∈ {"tags", "event"} con su ``segment_config``
  (``{"tags": [...], "match": "any"|"all"}`` o contexto del evento).
- ``trigger_type`` ∈ {"scheduled", "event"} con ``trigger_event``
  ∈ {"checkout.created", "payment.completed"}.
- ``last_triggered_at``: marca de la última ejecución (agendado → completed).

No requiere RLS adicional: el RLS es a nivel de tabla (``d4e5f6a7b8c9``) y las
nuevas columnas heredan la política ``tenant_isolation_policy`` existente.
Tampoco requiere trigger de ``revision``: es un añadido de columnas.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("bot_campaigns", sa.Column("segment_type", sa.String(length=32), nullable=True))
    op.add_column("bot_campaigns", sa.Column("segment_config", sa.JSON(), nullable=True))
    op.add_column("bot_campaigns", sa.Column("trigger_type", sa.String(length=32), nullable=True))
    op.add_column("bot_campaigns", sa.Column("trigger_event", sa.String(length=64), nullable=True))
    op.add_column(
        "bot_campaigns", sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bot_campaigns", "last_triggered_at")
    op.drop_column("bot_campaigns", "trigger_event")
    op.drop_column("bot_campaigns", "trigger_type")
    op.drop_column("bot_campaigns", "segment_config")
    op.drop_column("bot_campaigns", "segment_type")
