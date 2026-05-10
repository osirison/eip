from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.base import CamelModel

TargetType = Literal["project", "group"]


class PodTargetPayload(CamelModel):
    id: str
    target_type: TargetType
    target_id: str
    display_order: int


class PodSummaryPayload(CamelModel):
    id: str
    slug: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    target_count: int


class PodDetailPayload(PodSummaryPayload):
    targets: list[PodTargetPayload]


class PodsEnvelope(CamelModel):
    pods: list[PodSummaryPayload]


class PodEnvelope(CamelModel):
    pod: PodDetailPayload


class CreatePodTargetRequest(CamelModel):
    target_type: TargetType
    target_id: str = Field(pattern=r"^\d+$")

    @field_validator("target_id")
    @classmethod
    def normalize_target_id(cls, value: str) -> str:
        return value.strip()


class CreatePodRequest(CamelModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    targets: list[CreatePodTargetRequest] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None
