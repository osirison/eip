from __future__ import annotations

from sqlalchemy import select

import httpx

from app.core.config import Settings
from app.db.models import Pod, PodTarget
from app.db.seed import DEV_POD_SLUG
from app.services.gitlab import GitLabGateway
from app.services.reporting import ReportService


def test_fixture_pod_report_deduplicates_overlapping_targets(session, settings: Settings) -> None:
    pod = session.scalar(select(Pod).where(Pod.slug == DEV_POD_SLUG))
    assert pod is not None

    report = ReportService(session, settings, GitLabGateway(settings)).create_pod_report(pod.id)

    assert report.data_source == "fixture"
    assert report.target.type == "pod"
    assert report.target_coverage.requested_target_count == 3
    assert report.target_coverage.resolved_target_count == 3
    assert report.target_coverage.deduplicated_merge_requests < sum(
        item.merge_requests_analyzed for item in report.target_coverage.items
    )
    assert any(row.project_path == "platform/payments" for row in report.project_breakdown)
    assert any(flag.kind == "reviewer-concentration" for flag in report.attention_flags)


def test_fixture_partial_failure_still_returns_report(session, settings: Settings) -> None:
    pod = Pod(
        slug="partial-failure",
        name="Partial Failure",
        description="Exercises pod partial failure semantics",
        targets=[
            PodTarget(target_type="project", target_id="1042", display_order=0),
            PodTarget(target_type="group", target_id="999999", display_order=1),
        ],
    )
    session.add(pod)
    session.commit()

    report = ReportService(session, settings, GitLabGateway(settings)).create_pod_report(pod.id)

    assert report.target_coverage.partial_failure is True
    assert report.target_coverage.resolved_target_count == 1
    assert any(item.error == "The GitLab target was not found." for item in report.target_coverage.items)
    assert report.kpis.merge_requests_analyzed > 0


def test_fixture_empty_results_are_stable(session, settings: Settings) -> None:
    report = ReportService(session, settings, GitLabGateway(settings)).create_ad_hoc_report("project", "9090")

    assert report.kpis.merge_requests_analyzed == 0
    assert report.summary == [
        "No merge requests were returned for the selected target in the current analysis window."
    ]
    assert report.project_breakdown == []


def test_live_mode_uses_mocked_gitlab_responses(session, settings: Settings) -> None:
    live_settings = Settings(
        database_url=settings.database_url,
        gitlab_use_fixtures=False,
        gitlab_token="token",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v4/projects/1042":
            return httpx.Response(
                200,
                json={
                    "id": 1042,
                    "name": "Payments Platform",
                    "path_with_namespace": "platform/payments",
                    "web_url": "https://gitlab.example.com/platform/payments",
                },
            )
        if request.url.path == "/api/v4/projects/1042/merge_requests":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 3001,
                        "iid": 17,
                        "title": "Stabilize release train scheduling",
                        "web_url": "https://gitlab.example.com/platform/payments/-/merge_requests/17",
                        "state": "opened",
                        "author": {"id": 1, "name": "Ava Chen", "username": "avachen"},
                        "reviewers": [{"id": 2, "name": "Noah Patel", "username": "npatel"}],
                        "created_at": "2026-05-02T08:00:00.000Z",
                        "updated_at": "2026-05-09T08:00:00.000Z",
                        "merged_at": None,
                        "project_id": 1042,
                        "changes_count": "121",
                    },
                    {
                        "id": 3000,
                        "iid": 16,
                        "title": "Collapse duplicate queue metrics",
                        "web_url": "https://gitlab.example.com/platform/payments/-/merge_requests/16",
                        "state": "merged",
                        "draft": False,
                        "author": {"id": 2, "name": "Noah Patel", "username": "npatel"},
                        "reviewers": [{"id": 3, "name": "Lena Ortiz", "username": "lortiz"}],
                        "created_at": "2026-04-28T08:00:00.000Z",
                        "updated_at": "2026-05-03T10:00:00.000Z",
                        "merged_at": "2026-05-03T10:00:00.000Z",
                        "project_id": 1042,
                    },
                ],
            )
        if request.url.path == "/api/v4/projects/1042/merge_requests/16":
            return httpx.Response(200, json={"changes_count": "321"})

        return httpx.Response(404, json={"message": "404 Not Found"})

    report = ReportService(
        session,
        live_settings,
        GitLabGateway(live_settings, transport=httpx.MockTransport(handler)),
    ).create_ad_hoc_report("project", "1042")

    assert report.data_source == "live"
    assert report.kpis.merge_requests_analyzed == 2
    assert report.recent_merge_requests[0].changes_count == 121
    assert any(row.changes_count == 321 for row in report.recent_merge_requests)
    assert report.target.path == "platform/payments"