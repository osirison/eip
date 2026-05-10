from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Pod
from app.schemas.reports import (
    ContributorRollupRowPayload,
    ExecutiveReportPayload,
    GitLabTargetPayload,
    OpenQueuePayload,
    ProjectBreakdownRowPayload,
    ReportAttentionFlagPayload,
    ReportKpisPayload,
    ReportMergeRequestRowPayload,
    ReportWindowPayload,
    ReviewerLoadSignalPayload,
    ReviewerRollupRowPayload,
    TargetCoverageItemPayload,
    TargetCoveragePayload,
)
from app.services.errors import NotFoundError, UpstreamError
from app.services.gitlab import GitLabGateway
from app.services.models import GitLabMergeRequest, GitLabTarget
from app.services.pods import PodService

THIRTY_DAYS = timedelta(days=30)


@dataclass(slots=True)
class ResolvedTargetData:
    target: GitLabTarget
    merge_requests: list[GitLabMergeRequest]
    coverage_item: TargetCoverageItemPayload


class ReportService:
    def __init__(self, session: Session, settings: Settings, gateway: GitLabGateway) -> None:
        self.session = session
        self.settings = settings
        self.gateway = gateway
        self.pod_service = PodService(session)

    def create_ad_hoc_report(self, target_type: str, target_id: str) -> ExecutiveReportPayload:
        target = self.gateway.fetch_target(target_type, target_id)
        merge_requests = self.gateway.fetch_recent_merge_requests(
            target_type=target_type,
            target_id=target_id,
            target_path=target.path,
        )
        coverage_item = TargetCoverageItemPayload(
            id=target.id,
            type=target_type,
            name=target.name,
            path=target.path,
            resolved=True,
            merge_requests_analyzed=len(merge_requests),
            deduplicated_merge_requests=len(merge_requests),
            error=None,
        )
        target_coverage = TargetCoveragePayload(
            requested_target_count=1,
            resolved_target_count=1,
            projects_represented=len({merge_request.project_id for merge_request in merge_requests}),
            partial_failure=False,
            deduplicated_merge_requests=len(merge_requests),
            items=[coverage_item],
        )
        return self._aggregate_report(target, merge_requests, target_coverage)

    def create_pod_report(self, pod_id: str) -> ExecutiveReportPayload:
        pod_model = self.pod_service.get_pod_model(pod_id)
        coverage_items: list[TargetCoverageItemPayload] = []
        resolved_targets: list[ResolvedTargetData] = []
        failures: list[Exception] = []

        for target in pod_model.targets:
            try:
                gitlab_target = self.gateway.fetch_target(target.target_type, target.target_id)
                merge_requests = self.gateway.fetch_recent_merge_requests(
                    target_type=target.target_type,
                    target_id=target.target_id,
                    target_path=gitlab_target.path,
                )
            except (NotFoundError, UpstreamError) as error:
                coverage_items.append(
                    TargetCoverageItemPayload(
                        id=target.target_id,
                        type=target.target_type,
                        name=f"GitLab {target.target_type} {target.target_id}",
                        path=f"id:{target.target_id}",
                        resolved=False,
                        merge_requests_analyzed=0,
                        deduplicated_merge_requests=0,
                        error=str(error),
                    )
                )
                failures.append(error)
                continue

            coverage_item = TargetCoverageItemPayload(
                id=gitlab_target.id,
                type=gitlab_target.type,
                name=gitlab_target.name,
                path=gitlab_target.path,
                resolved=True,
                merge_requests_analyzed=len(merge_requests),
                deduplicated_merge_requests=0,
                error=None,
            )
            coverage_items.append(coverage_item)
            resolved_targets.append(ResolvedTargetData(gitlab_target, merge_requests, coverage_item))

        if not resolved_targets:
            if failures and all(isinstance(error, NotFoundError) for error in failures):
                raise NotFoundError("No GitLab targets configured on this pod could be resolved.")
            raise UpstreamError("GitLab returned an upstream error while generating the pod report.")

        deduplicated_merge_requests = self._deduplicate_merge_requests(resolved_targets)
        target_coverage = TargetCoveragePayload(
            requested_target_count=len(coverage_items),
            resolved_target_count=sum(1 for item in coverage_items if item.resolved),
            projects_represented=len({merge_request.project_id for merge_request in deduplicated_merge_requests}),
            partial_failure=any(not item.resolved for item in coverage_items),
            deduplicated_merge_requests=len(deduplicated_merge_requests),
            items=coverage_items,
        )

        pod_target = GitLabTarget(
            id=pod_model.id,
            type="pod",
            name=pod_model.name,
            path=pod_model.slug,
            web_url=None,
        )
        return self._aggregate_report(pod_target, deduplicated_merge_requests, target_coverage)

    def _aggregate_report(
        self,
        target: GitLabTarget,
        merge_requests: list[GitLabMergeRequest],
        target_coverage: TargetCoveragePayload,
    ) -> ExecutiveReportPayload:
        now = datetime.now(UTC)
        stale_cutoff = now - timedelta(days=self.settings.stale_days_threshold)
        thirty_day_cutoff = now - THIRTY_DAYS

        sorted_merge_requests = sorted(
            merge_requests,
            key=lambda merge_request: self._parse_iso_datetime(merge_request.updated_at),
            reverse=True,
        )
        open_merge_requests = [merge_request for merge_request in sorted_merge_requests if merge_request.state == "opened"]
        merged_merge_requests = [
            merge_request
            for merge_request in sorted_merge_requests
            if merge_request.state == "merged" and merge_request.merged_at
        ]
        stale_merge_requests = [
            merge_request
            for merge_request in open_merge_requests
            if self._parse_iso_datetime(merge_request.updated_at) <= stale_cutoff
        ]
        oversized_merge_requests = [
            merge_request
            for merge_request in sorted_merge_requests
            if (merge_request.changes_count or 0) >= self.settings.oversized_changes_threshold
        ]
        unreviewed_merge_requests = [
            merge_request for merge_request in open_merge_requests if len(merge_request.reviewers) == 0
        ]
        draft_merge_requests = [merge_request for merge_request in open_merge_requests if merge_request.draft]
        merged_last_30_days = [
            merge_request
            for merge_request in merged_merge_requests
            if merge_request.merged_at and self._parse_iso_datetime(merge_request.merged_at) >= thirty_day_cutoff
        ]

        contributor_rollup = self._build_contributor_rollup(sorted_merge_requests)
        reviewer_rollup = self._build_reviewer_rollup(sorted_merge_requests, len(open_merge_requests))
        reviewer_load_signal = self._build_reviewer_load_signal(reviewer_rollup)
        attention_flags = self._build_attention_flags(
            stale_merge_requests,
            oversized_merge_requests,
            unreviewed_merge_requests,
            reviewer_load_signal,
        )

        median_merge_time_hours = self._median(
            [
                (
                    self._parse_iso_datetime(merge_request.merged_at)
                    - self._parse_iso_datetime(merge_request.created_at)
                ).total_seconds()
                / 3600
                for merge_request in merged_merge_requests
                if merge_request.merged_at
            ]
        )

        return ExecutiveReportPayload(
            generated_at=now,
            data_source=self.gateway.data_source,
            target=GitLabTargetPayload.model_validate(target),
            window=ReportWindowPayload(
                merge_requests_analyzed=len(sorted_merge_requests),
                label=f"Last {len(sorted_merge_requests)} merge requests analyzed",
            ),
            kpis=ReportKpisPayload(
                merge_requests_analyzed=len(sorted_merge_requests),
                open_merge_requests=len(open_merge_requests),
                merged_last_30_days=len(merged_last_30_days),
                median_merge_time_hours=median_merge_time_hours,
                active_authors=len(contributor_rollup),
                active_reviewers=len(reviewer_rollup),
                active_projects=len({merge_request.project_id for merge_request in sorted_merge_requests}),
            ),
            summary=self._build_summary(
                total_count=len(sorted_merge_requests),
                open_count=len(open_merge_requests),
                stale_count=len(stale_merge_requests),
                merged_last_30_days_count=len(merged_last_30_days),
                median_merge_time_hours=median_merge_time_hours,
                top_contributor=contributor_rollup[0] if contributor_rollup else None,
                top_reviewer=reviewer_rollup[0] if reviewer_rollup else None,
                target_coverage=target_coverage,
                reviewer_load_signal=reviewer_load_signal,
            ),
            open_queue=OpenQueuePayload(
                total=len(open_merge_requests),
                stale=len(stale_merge_requests),
                draft=len(draft_merge_requests),
                oversized=len([merge_request for merge_request in open_merge_requests if merge_request in oversized_merge_requests]),
                unreviewed=len(unreviewed_merge_requests),
            ),
            recent_merge_requests=[
                self._build_merge_request_row(
                    merge_request,
                    stale_merge_requests,
                    oversized_merge_requests,
                    unreviewed_merge_requests,
                    now,
                )
                for merge_request in sorted_merge_requests[:10]
            ],
            stale_open_merge_requests=[
                self._build_merge_request_row(
                    merge_request,
                    stale_merge_requests,
                    oversized_merge_requests,
                    unreviewed_merge_requests,
                    now,
                )
                for merge_request in sorted(
                    stale_merge_requests,
                    key=lambda merge_request: self._parse_iso_datetime(merge_request.updated_at),
                )[:6]
            ],
            project_breakdown=self._build_project_breakdown(sorted_merge_requests, now),
            contributor_rollup=contributor_rollup,
            reviewer_rollup=reviewer_rollup,
            reviewer_load_signal=reviewer_load_signal,
            attention_flags=attention_flags,
            target_coverage=target_coverage,
        )

    def _build_project_breakdown(
        self,
        merge_requests: list[GitLabMergeRequest],
        now: datetime,
    ) -> list[ProjectBreakdownRowPayload]:
        stale_cutoff = now - timedelta(days=self.settings.stale_days_threshold)
        thirty_day_cutoff = now - THIRTY_DAYS
        grouped: dict[tuple[int, str], list[GitLabMergeRequest]] = defaultdict(list)
        for merge_request in merge_requests:
            grouped[(merge_request.project_id, merge_request.project_path or f"project-{merge_request.project_id}")].append(
                merge_request
            )

        rows: list[ProjectBreakdownRowPayload] = []
        for (project_id, project_path), project_merge_requests in grouped.items():
            open_merge_requests = [
                merge_request for merge_request in project_merge_requests if merge_request.state == "opened"
            ]
            stale_merge_requests = [
                merge_request
                for merge_request in open_merge_requests
                if self._parse_iso_datetime(merge_request.updated_at) <= stale_cutoff
            ]
            merged_last_30_days = [
                merge_request
                for merge_request in project_merge_requests
                if merge_request.merged_at
                and self._parse_iso_datetime(merge_request.merged_at) >= thirty_day_cutoff
            ]
            rows.append(
                ProjectBreakdownRowPayload(
                    project_id=project_id,
                    project_path=project_path,
                    merge_requests_analyzed=len(project_merge_requests),
                    open_merge_requests=len(open_merge_requests),
                    stale_merge_requests=len(stale_merge_requests),
                    merged_last_30_days=len(merged_last_30_days),
                    median_merge_time_hours=self._median(
                        [
                            (
                                self._parse_iso_datetime(merge_request.merged_at)
                                - self._parse_iso_datetime(merge_request.created_at)
                            ).total_seconds()
                            / 3600
                            for merge_request in project_merge_requests
                            if merge_request.merged_at
                        ]
                    ),
                    active_authors=len({merge_request.author.username for merge_request in project_merge_requests}),
                    active_reviewers=len(
                        {
                            reviewer.username
                            for merge_request in project_merge_requests
                            for reviewer in merge_request.reviewers
                        }
                    ),
                )
            )

        return sorted(
            rows,
            key=lambda row: (-row.merge_requests_analyzed, row.project_path),
        )

    def _build_merge_request_row(
        self,
        merge_request: GitLabMergeRequest,
        stale_merge_requests: list[GitLabMergeRequest],
        oversized_merge_requests: list[GitLabMergeRequest],
        unreviewed_merge_requests: list[GitLabMergeRequest],
        now: datetime,
    ) -> ReportMergeRequestRowPayload:
        stale_ids = {item.id for item in stale_merge_requests}
        oversized_ids = {item.id for item in oversized_merge_requests}
        unreviewed_ids = {item.id for item in unreviewed_merge_requests}
        age_days = max((now - self._parse_iso_datetime(merge_request.created_at)).days, 0)
        return ReportMergeRequestRowPayload(
            id=merge_request.id,
            iid=merge_request.iid,
            title=merge_request.title,
            web_url=merge_request.web_url,
            state=merge_request.state,
            author_name=merge_request.author.name,
            reviewer_count=len(merge_request.reviewers),
            reviewer_names=[reviewer.name for reviewer in merge_request.reviewers],
            changes_count=merge_request.changes_count,
            updated_at=merge_request.updated_at,
            created_at=merge_request.created_at,
            age_days=age_days,
            project_path=merge_request.project_path,
            stale=merge_request.id in stale_ids,
            is_oversized=merge_request.id in oversized_ids,
            draft=merge_request.draft,
            unreviewed=merge_request.id in unreviewed_ids,
        )

    def _build_contributor_rollup(
        self,
        merge_requests: list[GitLabMergeRequest],
    ) -> list[ContributorRollupRowPayload]:
        contributors: dict[str, ContributorRollupRowPayload] = {}
        for merge_request in merge_requests:
            contributor = contributors.get(merge_request.author.username)
            if contributor is None:
                contributor = ContributorRollupRowPayload(
                    name=merge_request.author.name,
                    username=merge_request.author.username,
                    authored_count=0,
                    merged_count=0,
                    open_count=0,
                )
                contributors[merge_request.author.username] = contributor

            contributor.authored_count += 1
            if merge_request.state == "merged":
                contributor.merged_count += 1
            if merge_request.state == "opened":
                contributor.open_count += 1

        return sorted(contributors.values(), key=lambda row: (-row.authored_count, row.name))

    def _build_reviewer_rollup(
        self,
        merge_requests: list[GitLabMergeRequest],
        open_merge_request_count: int,
    ) -> list[ReviewerRollupRowPayload]:
        reviewers: dict[str, ReviewerRollupRowPayload] = {}
        total_assignments = sum(len(merge_request.reviewers) for merge_request in merge_requests)
        overload_threshold = max(2, open_merge_request_count // 2) if open_merge_request_count else 2

        for merge_request in merge_requests:
            for reviewer in merge_request.reviewers:
                reviewer_row = reviewers.get(reviewer.username)
                if reviewer_row is None:
                    reviewer_row = ReviewerRollupRowPayload(
                        name=reviewer.name,
                        username=reviewer.username,
                        assignment_count=0,
                        open_assignment_count=0,
                        merged_assignment_count=0,
                        concentration_share=0,
                        is_overloaded=False,
                    )
                    reviewers[reviewer.username] = reviewer_row

                reviewer_row.assignment_count += 1
                if merge_request.state == "opened":
                    reviewer_row.open_assignment_count += 1
                if merge_request.state == "merged":
                    reviewer_row.merged_assignment_count += 1

        for reviewer in reviewers.values():
            reviewer.concentration_share = (
                round((reviewer.assignment_count / total_assignments) * 100, 1) if total_assignments else 0
            )
            reviewer.is_overloaded = reviewer.open_assignment_count >= overload_threshold

        return sorted(reviewers.values(), key=lambda row: (-row.assignment_count, row.name))

    def _build_reviewer_load_signal(
        self,
        reviewer_rollup: list[ReviewerRollupRowPayload],
    ) -> ReviewerLoadSignalPayload:
        if not reviewer_rollup:
            return ReviewerLoadSignalPayload(
                top_reviewer_name=None,
                top_reviewer_share=0,
                risk="balanced",
                overloaded_reviewers=[],
                summary="No reviewer assignments were found in the current analysis window.",
            )

        top_reviewer = reviewer_rollup[0]
        if top_reviewer.concentration_share >= 50:
            risk = "high"
        elif top_reviewer.concentration_share >= 35:
            risk = "watch"
        else:
            risk = "balanced"

        overloaded_reviewers = [row.name for row in reviewer_rollup if row.is_overloaded]
        summary = (
            f"{top_reviewer.name} carries {top_reviewer.concentration_share:.1f}% of all review assignments"
            f" with {top_reviewer.open_assignment_count} open reviews currently assigned."
        )

        return ReviewerLoadSignalPayload(
            top_reviewer_name=top_reviewer.name,
            top_reviewer_share=top_reviewer.concentration_share,
            risk=risk,
            overloaded_reviewers=overloaded_reviewers,
            summary=summary,
        )

    def _build_attention_flags(
        self,
        stale_merge_requests: list[GitLabMergeRequest],
        oversized_merge_requests: list[GitLabMergeRequest],
        unreviewed_merge_requests: list[GitLabMergeRequest],
        reviewer_load_signal: ReviewerLoadSignalPayload,
    ) -> list[ReportAttentionFlagPayload]:
        flags: list[ReportAttentionFlagPayload] = []
        if stale_merge_requests:
            flags.append(
                ReportAttentionFlagPayload(
                    kind="stale",
                    title="Stale open merge requests",
                    description=(
                        f"{len(stale_merge_requests)} open merge requests have been idle for "
                        f"{self.settings.stale_days_threshold}+ days."
                    ),
                    severity="high" if len(stale_merge_requests) >= 2 else "medium",
                    count=len(stale_merge_requests),
                    examples=[merge_request.title for merge_request in stale_merge_requests[:3]],
                )
            )
        if oversized_merge_requests:
            flags.append(
                ReportAttentionFlagPayload(
                    kind="oversized",
                    title="Oversized change sets",
                    description=(
                        f"{len(oversized_merge_requests)} merge requests exceed "
                        f"{self.settings.oversized_changes_threshold:,} changed lines."
                    ),
                    severity="high" if len(oversized_merge_requests) >= 2 else "medium",
                    count=len(oversized_merge_requests),
                    examples=[merge_request.title for merge_request in oversized_merge_requests[:3]],
                )
            )
        if unreviewed_merge_requests:
            flags.append(
                ReportAttentionFlagPayload(
                    kind="unreviewed",
                    title="Open merge requests without reviewers",
                    description=(
                        f"{len(unreviewed_merge_requests)} open merge requests do not currently list a reviewer."
                    ),
                    severity="high" if len(unreviewed_merge_requests) >= 2 else "medium",
                    count=len(unreviewed_merge_requests),
                    examples=[merge_request.title for merge_request in unreviewed_merge_requests[:3]],
                )
            )
        if reviewer_load_signal.risk in {"watch", "high"} and reviewer_load_signal.top_reviewer_name:
            flags.append(
                ReportAttentionFlagPayload(
                    kind="reviewer-concentration",
                    title="Reviewer concentration is elevated",
                    description=reviewer_load_signal.summary,
                    severity="high" if reviewer_load_signal.risk == "high" else "medium",
                    count=len(reviewer_load_signal.overloaded_reviewers) or 1,
                    examples=reviewer_load_signal.overloaded_reviewers[:3]
                    or [reviewer_load_signal.top_reviewer_name],
                )
            )
        return flags

    def _build_summary(
        self,
        *,
        total_count: int,
        open_count: int,
        stale_count: int,
        merged_last_30_days_count: int,
        median_merge_time_hours: float | None,
        top_contributor: ContributorRollupRowPayload | None,
        top_reviewer: ReviewerRollupRowPayload | None,
        target_coverage: TargetCoveragePayload,
        reviewer_load_signal: ReviewerLoadSignalPayload,
    ) -> list[str]:
        if total_count == 0:
            return [
                "No merge requests were returned for the selected target in the current analysis window."
            ]

        summary = [
            (
                f"{open_count} of {total_count} analyzed merge requests are currently open, with {stale_count}"
                f" already idle beyond {self.settings.stale_days_threshold} days."
            ),
            (
                f"{merged_last_30_days_count} merge requests were merged in the last 30 days"
                + (
                    "."
                    if median_merge_time_hours is None
                    else f" and the median merge time is {self._format_hours(median_merge_time_hours)}."
                )
            ),
            (
                f"Coverage resolved {target_coverage.resolved_target_count} of "
                f"{target_coverage.requested_target_count} configured targets across "
                f"{target_coverage.projects_represented} projects."
            ),
        ]

        if top_contributor is not None:
            summary.append(
                f"{top_contributor.name} authored the highest volume in this window with {top_contributor.authored_count} merge requests."
            )
        if top_reviewer is not None:
            summary.append(
                f"{top_reviewer.name} carries the heaviest review load with {top_reviewer.assignment_count} assignments in the current window."
            )
        if reviewer_load_signal.top_reviewer_name and reviewer_load_signal.risk != "balanced":
            summary.append(reviewer_load_signal.summary)

        return summary

    def _deduplicate_merge_requests(
        self,
        resolved_targets: list[ResolvedTargetData],
    ) -> list[GitLabMergeRequest]:
        seen_ids: set[int] = set()
        deduplicated: list[GitLabMergeRequest] = []
        for resolved_target in resolved_targets:
            for merge_request in resolved_target.merge_requests:
                if merge_request.id in seen_ids:
                    continue
                seen_ids.add(merge_request.id)
                deduplicated.append(merge_request)
                resolved_target.coverage_item.deduplicated_merge_requests += 1
        return deduplicated

    @staticmethod
    def _parse_iso_datetime(value: str | None) -> datetime:
        if value is None:
            return datetime.fromtimestamp(0, UTC)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    @staticmethod
    def _median(values: list[float]) -> float | None:
        if not values:
            return None
        sorted_values = sorted(values)
        middle = len(sorted_values) // 2
        if len(sorted_values) % 2 == 0:
            return round((sorted_values[middle - 1] + sorted_values[middle]) / 2, 1)
        return round(sorted_values[middle], 1)

    @staticmethod
    def _format_hours(value: float) -> str:
        if value < 24:
            return f"{value:.1f} hours"
        return f"{value / 24:.1f} days"
