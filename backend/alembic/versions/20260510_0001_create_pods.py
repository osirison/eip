"""create pods tables

Revision ID: 20260510_0001
Revises: 
Create Date: 2026-05-10 23:30:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260510_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pods",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_pods_slug", "pods", ["slug"], unique=True)

    op.create_table(
        "pod_targets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("pod_id", sa.String(length=36), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.String(length=32), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["pod_id"], ["pods.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("pod_id", "target_type", "target_id", name="uq_pod_targets_scope"),
    )
    op.create_index("ix_pod_targets_pod_id", "pod_targets", ["pod_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pod_targets_pod_id", table_name="pod_targets")
    op.drop_table("pod_targets")
    op.drop_index("ix_pods_slug", table_name="pods")
    op.drop_table("pods")
