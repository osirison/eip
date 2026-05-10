from fastapi import APIRouter, Depends

from app.api.deps import get_report_service
from app.schemas.reports import AdHocReportRequest, ReportEnvelope
from app.services.reporting import ReportService

router = APIRouter(prefix="/v1/reports", tags=["reports"])


@router.post("/ad-hoc", response_model=ReportEnvelope)
def create_ad_hoc_report(
    request: AdHocReportRequest,
    service: ReportService = Depends(get_report_service),
) -> ReportEnvelope:
    return ReportEnvelope(report=service.create_ad_hoc_report(request.target_type, request.target_id))


@router.post("/pods/{pod_id}", response_model=ReportEnvelope)
def create_pod_report(
    pod_id: str,
    service: ReportService = Depends(get_report_service),
) -> ReportEnvelope:
    return ReportEnvelope(report=service.create_pod_report(pod_id))
