"""merge_crm_y_documents_branches

Revision ID: 068511c26fcc
Revises: a7b8c9d0e1f2, f8a9b0c1d2e3
Create Date: 2026-08-31 00:20:41.386786+00:00

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '068511c26fcc'
down_revision: str | None = ('a7b8c9d0e1f2', 'f8a9b0c1d2e3')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
