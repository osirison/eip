from fastapi import APIRouter, Depends, status

from app.api.deps import get_pod_service
from app.schemas.pods import CreatePodRequest, PodEnvelope, PodsEnvelope
from app.services.pods import PodService

router = APIRouter(prefix="/v1/pods", tags=["pods"])


@router.get("", response_model=PodsEnvelope)
def list_pods(service: PodService = Depends(get_pod_service)) -> PodsEnvelope:
    return PodsEnvelope(pods=service.list_pods())


@router.post("", response_model=PodEnvelope, status_code=status.HTTP_201_CREATED)
def create_pod(
    request: CreatePodRequest,
    service: PodService = Depends(get_pod_service),
) -> PodEnvelope:
    return PodEnvelope(pod=service.create_pod(request))


@router.get("/{pod_id}", response_model=PodEnvelope)
def get_pod(pod_id: str, service: PodService = Depends(get_pod_service)) -> PodEnvelope:
    return PodEnvelope(pod=service.get_pod(pod_id))
