from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Pod, PodTarget
from app.schemas.pods import CreatePodRequest, PodDetailPayload, PodSummaryPayload
from app.services.errors import ConflictError, NotFoundError


class PodService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_pods(self) -> list[PodSummaryPayload]:
        pods = self.session.scalars(
            select(Pod).options(selectinload(Pod.targets)).order_by(Pod.name.asc())
        ).all()
        return [PodSummaryPayload.model_validate(pod) for pod in pods]

    def get_pod(self, pod_id: str) -> PodDetailPayload:
        pod = self.session.scalar(
            select(Pod).where(Pod.id == pod_id).options(selectinload(Pod.targets))
        )
        if pod is None:
            raise NotFoundError("The requested pod was not found.")

        return PodDetailPayload.model_validate(pod)

    def get_pod_model(self, pod_id: str) -> Pod:
        pod = self.session.scalar(
            select(Pod).where(Pod.id == pod_id).options(selectinload(Pod.targets))
        )
        if pod is None:
            raise NotFoundError("The requested pod was not found.")

        return pod

    def create_pod(self, request: CreatePodRequest) -> PodDetailPayload:
        slug = request.slug or self._slugify(request.name)
        existing = self.session.scalar(select(Pod).where(Pod.slug == slug))
        if existing is not None:
            raise ConflictError("A pod with this slug already exists.")

        pod = Pod(
            slug=slug,
            name=request.name,
            description=request.description,
            targets=[],
        )

        seen_targets: set[tuple[str, str]] = set()
        for target in request.targets:
            key = (target.target_type, target.target_id)
            if key in seen_targets:
                continue
            seen_targets.add(key)
            pod.targets.append(
                PodTarget(
                    target_type=target.target_type,
                    target_id=target.target_id,
                    display_order=len(pod.targets),
                )
            )

        self.session.add(pod)
        self.session.commit()
        self.session.refresh(pod)
        pod = self.get_pod_model(pod.id)
        return PodDetailPayload.model_validate(pod)

    @staticmethod
    def _slugify(value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
        return normalized[:80] or "pod"
