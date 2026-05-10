from collections.abc import Generator

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import session_scope
from app.services.gitlab import GitLabGateway
from app.services.pods import PodService
from app.services.reporting import ReportService


def get_settings_dependency() -> Settings:
    return get_settings()


def get_db_session(
    settings: Settings = Depends(get_settings_dependency),
) -> Generator[Session, None, None]:
    yield from session_scope(settings.database_url)


def get_gitlab_gateway(
    settings: Settings = Depends(get_settings_dependency),
) -> GitLabGateway:
    return GitLabGateway(settings)


def get_pod_service(session: Session = Depends(get_db_session)) -> PodService:
    return PodService(session)


def get_report_service(
    session: Session = Depends(get_db_session),
    settings: Settings = Depends(get_settings_dependency),
    gateway: GitLabGateway = Depends(get_gitlab_gateway),
) -> ReportService:
    return ReportService(session, settings, gateway)
