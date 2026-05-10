# Engineering Intelligence Platform Technical Design

## 1. Purpose

Engineering Intelligence Platform (EIP) provides executive-grade reporting over engineering delivery signals. The target state supports portfolio-level reporting, AI-assisted analysis, governed access, and durable historical trend data. The initial proof of concept (POC) narrows scope to fast GitLab reporting for a single GitLab Project ID or Group ID while keeping the target-state architecture explicit.

This document is the source of truth for the target-state architecture and records the deliberate POC cut.

## 2. Problem Statement

Engineering leaders need a concise, trustworthy view of delivery health without manually stitching together merge request activity, reviewer load, and attention hotspots from GitLab. The system must turn source-system activity into high-signal reporting that is useful for directors and VPs, not expose raw API payloads.

## 3. Goals

- Provide executive reporting for GitLab project and group targets.
- Highlight current delivery posture with KPIs, attention flags, and recent merge activity.
- Keep GitLab credentials server-side only.
- Preserve a clean separation between the target-state platform architecture and the narrower POC delivery shape.
- Enable local development and tests without live GitLab credentials by using fixtures for aggregation logic.

## 4. Non-Goals For The POC

- Multi-tenant authorization and permissions.
- Enterprise security hardening beyond basic server-side secret handling.
- Durable storage in PostgreSQL.
- Background processing with Celery and Redis.
- FastAPI service decomposition.
- Copilot ingestion pipelines.
- Ask Your Data or natural-language analytics.
- Hierarchical rollups beyond a single GitLab project or group lookup.
- Historical trending beyond the recent merge-request analysis window.

## 5. Users And Primary Flow

### Users

- Engineering executives who need fast status reporting.
- Engineering managers who need to inspect recent merge-request throughput and review load.

### Primary POC Flow

1. User opens the app.
2. User selects either Project or Group target type.
3. User enters a GitLab numeric identifier.
4. The application generates a concise report from recent GitLab merge-request activity.
5. The user reviews KPIs, recent merge requests, contributor and reviewer rollups, and attention flags.

## 6. Target-State Architecture

### 6.1 Frontend

- Next.js application for authenticated end-user experiences.
- Shadcn/UI component system for consistent, enterprise-quality reporting surfaces.
- Dashboard-oriented views for executive summaries, drill-downs, and historical comparisons.

### 6.2 API Layer

- FastAPI service boundary for reporting APIs, orchestration, and policy enforcement.
- Typed REST endpoints for report generation, trend retrieval, metadata lookup, and future conversational analytics.

### 6.3 Data And Jobs

- PostgreSQL for durable report snapshots, entity metadata, historical measures, and audit-friendly storage.
- Redis for cache coordination and queue brokering.
- Celery workers for scheduled ingestion, enrichment, and backfill tasks.

### 6.4 Data Sources And Analytics

- GitLab as the initial engineering system of record.
- Future connectors for additional delivery systems.
- AI-assisted summarization and question-answering over curated reporting datasets.
- Copilot ingestion and Ask Your Data capabilities layered on normalized stored data, not directly on raw browser responses.

### 6.5 Security And Governance

- Server-side secret storage only.
- Role-based access controls and scoped target visibility in the target state.
- Auditable report access and configuration changes.
- Separation between user-facing applications and source-system credentials.

## 7. POC Delivery Architecture

The POC intentionally collapses the system into a single Next.js App Router application to maximize delivery speed while preserving clean seams for later extraction.

### Included In The POC

- Next.js App Router UI and server routes in one codebase.
- Server-side GitLab API access using environment variables.
- Typed aggregation logic that transforms recent merge-request activity into executive reporting.
- Fixture-backed development mode when live credentials are unavailable.
- Focused unit tests for aggregation behavior.

### Deferred From The POC

- FastAPI service extraction.
- PostgreSQL persistence and report history.
- Celery and Redis asynchronous workflows.
- Copilot ingestion.
- Ask Your Data.
- Hierarchy, permissions, and enterprise security hardening.

## 8. Domain Model

### Reporting Target

- `type`: `project` or `group`
- `id`: GitLab numeric identifier
- `name`: human-readable target name
- `path`: GitLab namespace path
- `web_url`: browser URL when available

### Merge Request Fact

- `id`, `iid`, `project_id`
- `title`, `state`, `draft`
- `author`
- `reviewers`
- `created_at`, `updated_at`, `merged_at`
- `changes_count`
- `web_url`

### Executive Report

- target metadata
- generated timestamp
- data source indicator (`live` or `fixture`)
- analysis window size
- summary KPIs
- executive summary insights
- recent merge-request table rows
- contributor rollup
- reviewer rollup
- attention flags

## 9. POC Functional Requirements

### Required

- Accept Project or Group as the reporting target type.
- Accept a GitLab ID and generate a report.
- Use `GITLAB_BASE_URL` and `GITLAB_TOKEN` server-side only.
- Present summary KPIs.
- Present a recent merge-request table.
- Present contributor and reviewer rollups.
- Present simple attention flags such as stale merge requests and oversized changes.
- Handle loading, empty, and error states cleanly.
- Continue to work locally without live credentials through fixtures for aggregation logic.

### Nice To Have Within POC

- Support both project and group reporting in the first pass.
- Provide short executive summary statements derived from report metrics.
- Show whether the report used fixtures or live data.

## 10. API Contract For The POC

### `POST /api/report`

Request body:

```json
{
  "targetType": "project",
  "targetId": "12345"
}
```

Successful response shape:

```json
{
  "report": {
    "generatedAt": "2026-05-10T12:00:00.000Z",
    "dataSource": "live",
    "target": {
      "type": "project",
      "id": "12345",
      "name": "Payments Platform",
      "path": "platform/payments"
    },
    "window": {
      "mergeRequestsAnalyzed": 25,
      "label": "Recent merge requests"
    },
    "kpis": {},
    "summary": [],
    "recentMergeRequests": [],
    "contributorRollup": [],
    "reviewerRollup": [],
    "attentionFlags": []
  }
}
```

Error semantics:

- `400` for invalid target type or identifier.
- `404` when the GitLab target is not found.
- `502` for upstream GitLab failures.

## 11. Reporting Logic

The POC report is derived from a recent merge-request analysis window.

### KPIs

- Merge requests analyzed.
- Open merge requests.
- Merge requests merged in the last 30 days.
- Median merge time for merged merge requests in the analysis window.

### Rollups

- Contributor authored count, merged count, and open count.
- Reviewer review assignments across the analysis window.

### Attention Flags

- Stale open merge requests older than a configurable threshold.
- Oversized merge requests above a configurable changed-lines threshold.
- Open merge requests with no reviewer assigned.

## 12. Environment Configuration

- `GITLAB_BASE_URL`: GitLab host or API base URL. If the value does not end in `/api/v4`, the application appends it.
- `GITLAB_TOKEN`: GitLab token used only on the server.
- `GITLAB_USE_FIXTURES`: Optional local-development override to force fixture mode.

## 13. Testing Strategy

- Unit tests cover report aggregation and flag generation using deterministic fixtures.
- Validation commands for the touched scope include lint, typecheck, and targeted tests.
- Live GitLab integration remains runtime-verified through manual local testing when credentials are available.

## 14. Delivery Plan

### Epic 1

Planning artifacts, target-state TDD, and single-app POC foundation.

### Epic 2

GitLab client and report-generation engine with fixture-backed tests.

### Epic 3

Executive report UI, loading and empty states, and local run guidance.

## 15. Exit Criteria For This POC

- A user can generate a GitLab executive report from a project or group ID.
- The report is concise and visually credible for executive review.
- The implementation runs as a single Next.js application.
- GitLab credentials never leave the server runtime.
- The codebase contains a clear migration path toward the target-state architecture.