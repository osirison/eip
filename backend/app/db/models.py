from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Pod(TimestampMixin, Base):
    __tablename__ = "pods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    targets: Mapped[list[PodTarget]] = relationship(
        "PodTarget",
        back_populates="pod",
        cascade="all, delete-orphan",
        order_by="PodTarget.display_order",
    )

    @property
    def target_count(self) -> int:
        return len(self.targets)


class PodTarget(Base):
    __tablename__ = "pod_targets"
    __table_args__ = (
        UniqueConstraint("pod_id", "target_type", "target_id", name="uq_pod_targets_scope"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    pod_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("pods.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[str] = mapped_column(String(32), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    pod: Mapped[Pod] = relationship("Pod", back_populates="targets")
