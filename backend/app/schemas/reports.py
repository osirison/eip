from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel

DataSource = Literal["fixture", "live"]
ReportTargetType = Literal["project", "group", "pod"]
ReportState = Literal["opened", "merged", "closed", "locked"]
ReportAttentionKind = Literal["stale", "oversized", "unreviewed", "reviewer-concentration"]
ReviewerRisk = Literal["balanced", "watch", "high"]


class GitLabPersonPayload(CamelModel):
    id: int
    name: str
    username: str
    web_url: str | None = None


class GitLabTargetPayload(CamelModel):
    id: str
    type: ReportTargetType
    name: str
    path: str
    web_url: str | None = None


class ReportWindowPayload(CamelModel):
    merge_requests_analyzed: int
    label: str


class ReportKpisPayload(CamelModel):
    merge_requests_analyzed: int
    open_merge_requests: int
    merged_last_30_days: int
    median_merge_time_hours: float | None
    active_authors: int
    active_reviewers: int
    active_projects: int


class ReportMergeRequestRowPayload(CamelModel):
    id: int
    iid: int
    title: str
    web_url: str
    state: ReportState
    author_name: str
    reviewer_count: int
    reviewer_names: list[str]
    changes_count: int | None
    updated_at: str
    created_at: str
    age_days: int
    project_path: str | None
    stale: bool
    is_oversized: bool
    draft: bool
    unreviewed: bool


class ContributorRollupRowPayload(CamelModel):
    name: str
    username: str
    authored_count: int
    merged_count: int
    open_count: int


class ReviewerRollupRowPayload(CamelModel):
    name: str
    username: str
    assignment_count: int
    open_assignment_count: int
    merged_assignment_count: int
    concentration_share: float
    is_overloaded: bool


class ReportAttentionFlagPayload(CamelModel):
    kind: ReportAttentionKind
    title: str
    description: str
    severity: Literal["medium", "high"]
    count: int
    examples: list[str]


class OpenQueuePayload(CamelModel):
    total: int
    stale: int
    draft: int
    oversized: int
    unreviewed: int


class ProjectBreakdownRowPayload(CamelModel):
    project_id: int
    project_path: str
    merge_requests_analyzed: int
    open_merge_requests: int
    stale_merge_requests: int
    merged_last_30_days: int
    median_merge_time_hours: float | None
    active_authors: int
    active_reviewers: int


class TargetCoverageItemPayload(CamelModel):
    id: str
    type: Literal["project", "group"]
    name: str
    path: str
    resolved: bool
    merge_requests_analyzed: int
    deduplicated_merge_requests: int
    error: str | None = None


class TargetCoveragePayload(CamelModel):
    requested_target_count: int
    resolved_target_count: int
    projects_represented: int
    partial_failure: bool
    deduplicated_merge_requests: int
    items: list[TargetCoverageItemPayload]


class ReviewerLoadSignalPayload(CamelModel):
    top_reviewer_name: str | None = None
    top_reviewer_share: float = 0
    risk: ReviewerRisk
    overloaded_reviewers: list[str] = Field(default_factory=list)
    summary: str


class ExecutiveReportPayload(CamelModel):
    generated_at: datetime
    data_source: DataSource
    target: GitLabTargetPayload
    window: ReportWindowPayload
    kpis: ReportKpisPayload
    summary: list[str]
    open_queue: OpenQueuePayload
    recent_merge_requests: list[ReportMergeRequestRowPayload]
    stale_open_merge_requests: list[ReportMergeRequestRowPayload]
    project_breakdown: list[ProjectBreakdownRowPayload]
    contributor_rollup: list[ContributorRollupRowPayload]
    reviewer_rollup: list[ReviewerRollupRowPayload]
    reviewer_load_signal: ReviewerLoadSignalPayload
    attention_flags: list[ReportAttentionFlagPayload]
    target_coverage: TargetCoveragePayload


class ReportEnvelope(CamelModel):
    report: ExecutiveReportPayload


class AdHocReportRequest(CamelModel):
    target_type: Literal["project", "group"]
    target_id: str = Field(pattern=r"^\d+$")
