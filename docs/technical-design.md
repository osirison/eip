# Engineering Intelligence Platform Technical Design

## 1. Purpose

Engineering Intelligence Platform (EIP) provides executive-grade reporting over engineering delivery signals. The current implementation delivers a browser-facing Next.js application backed by FastAPI and PostgreSQL, while preserving a clean path toward future historical analytics, richer governance, and asynchronous ingestion.

This document is the source of truth for the implemented architecture and the major capabilities still deferred.

## 2. Problem Statement

Engineering leaders need a concise, trustworthy view of delivery health without manually stitching together merge-request activity, reviewer load, and attention hotspots from GitLab. The system must turn source-system activity into high-signal reporting that is useful for directors and VPs, not expose raw API payloads or credentials to the browser.

## 3. Goals

- Provide executive reporting for GitLab projects, groups, and reusable pods.
- Highlight delivery posture with KPIs, attention flags, target coverage, and recent merge activity.
- Keep GitLab credentials and upstream access server-side only.
- Persist pod definitions in PostgreSQL.
- Preserve a strict separation between the browser-facing Next.js app and the reporting backend.
- Enable local development and automated tests without live GitLab credentials through fixtures.

## 4. Current Non-Goals

- Multi-tenant authorization and fine-grained permissions.
- Enterprise hardening beyond server-side secret handling and typed backend boundaries.
- Durable report snapshots and historical trend storage.
- Background processing with Celery and Redis.
- Copilot ingestion pipelines.
- Ask Your Data or natural-language analytics.
- Cross-source connectors beyond GitLab.

## 5. Users And Primary Flows

### Users

- Engineering executives who need a fast operational view of delivery health.
- Engineering managers who need to inspect queue quality, reviewer load, and repository posture.

### Pod Flow

1. User opens the workbench.
2. User selects a saved pod from the left rail.
3. Next.js fetches pod metadata and a pod report through thin proxy routes.
4. FastAPI loads pod targets from PostgreSQL, aggregates GitLab data, and returns a single executive report.
5. The user reviews overview metrics, target coverage, merge requests, contributor activity, reviewer distribution, and attention flags.

### Ad-Hoc Flow

1. User chooses a project or group target type.
2. User enters a GitLab numeric identifier.
3. Next.js proxies the request to FastAPI.
4. FastAPI resolves the target, queries GitLab or fixtures, and returns the report.

## 6. Implemented Architecture

### 6.1 Browser Application

- Next.js App Router remains the only browser-facing application.
- The main workbench renders pod selection, ad-hoc reporting, and grouped report sections.
- Browser clients never call GitLab directly.

### 6.2 Next.js Proxy Layer

- `/api/report` proxies ad-hoc report generation.
- `/api/pods` lists and creates pods.
- `/api/pods/:podId` returns pod detail.
- `/api/pods/:podId/report` generates a pod-level report.
- Proxy handlers validate input and normalize backend errors for the UI.

### 6.3 FastAPI Backend

- FastAPI owns pod persistence, GitLab access, fixture or live mode, and report aggregation.
- Core endpoints are:
  - `GET /healthz`
  - `GET /v1/pods`
  - `POST /v1/pods`
  - `GET /v1/pods/{podId}`
  - `POST /v1/reports/ad-hoc`
  - `POST /v1/reports/pods/{podId}`
- Service boundaries are split across pod management, GitLab gateway behavior, and reporting aggregation.

### 6.4 Data Layer

- PostgreSQL stores pods and pod targets.
- Alembic manages schema evolution.
- Development seeding provides a reusable starter pod.
- The current release persists pod configuration, not historical report snapshots.

### 6.5 GitLab Integration

- FastAPI can run in fixture mode or live GitLab mode.
- The backend normalizes GitLab base URLs to `/api/v4`.
- Pod reports deduplicate overlapping merge requests across project and group targets.
- The reporting service computes open queue state, stale work, oversized changes, unreviewed work, target coverage, per-project posture, and reviewer concentration signals.

### 6.6 Security Boundary

- GitLab tokens are stored only in the backend environment.
- The frontend only needs the backend base URL.
- The browser receives normalized report data rather than raw GitLab responses.

## 7. Future-State Extensions

- Historical report snapshots and trend queries in PostgreSQL.
- Redis and Celery for scheduled ingestion, caching, and backfills.
- Role-based access controls and auditable configuration changes.
- Additional engineering-system connectors.
- AI-assisted summarization and conversational analytics on curated stored data.

## 8. Domain Model

### Reporting Target

- `type`: `project`, `group`, or `pod`
- `id`: GitLab numeric identifier or pod UUID
- `name`: human-readable target name
- `path`: GitLab namespace path or pod slug
- `webUrl`: browser URL when available

### Pod

- `id`, `slug`, `name`, `description`
- ordered list of targets
- each target includes `targetType`, `targetId`, and `displayOrder`

### Merge Request Fact

- `id`, `iid`, `projectId`, `projectPath`
- `title`, `state`, `draft`
- `author`, `reviewers`
- `createdAt`, `updatedAt`, `mergedAt`
- `changesCount`, `webUrl`

### Executive Report

- target metadata and generation metadata
- KPIs for merge throughput, queue state, and active footprint
- executive summary statements
- open queue breakdown
- recent merge requests and stale open merge requests
- contributor and reviewer rollups
- reviewer concentration signal
- attention flags
- target coverage and per-project breakdown

## 9. Functional Requirements

### Required

- Accept project and group IDs for ad-hoc report generation.
- Persist reusable pods made from project IDs and group IDs.
- Generate pod-level reports with target overlap deduplication.
- Keep `GITLAB_TOKEN` backend-only.
- Present summary KPIs, queue breakdown, target coverage, merge requests, contributor rollups, reviewer rollups, and attention flags.
- Handle loading, empty, and error states cleanly.
- Continue to work locally without live credentials through fixtures.

### Included Enhancements

- GitLab-inspired workbench styling.
- Left-hand navigation that groups report sections.
- Stronger reviewer concentration and queue-quality reporting.
- Per-project breakdown across pod scope.

## 10. API Contracts

### Next.js Proxy Surface

#### `POST /api/report`

Request body:

```json
{
  "targetType": "project",
  "targetId": "12345"
}
```

#### `GET /api/pods`

Returns saved pods with summary metadata.

#### `POST /api/pods`

Request body:

```json
{
  "name": "Platform Foundation",
  "description": "Core platform scope",
  "targets": [
    { "targetType": "group", "targetId": "7" },
    { "targetType": "project", "targetId": "1042" }
  ]
}
```

#### `GET /api/pods/:podId`

Returns pod detail including ordered targets.

#### `POST /api/pods/:podId/report`

Returns an executive report for the persisted pod.

### Backend Error Semantics

- `400` for invalid input.
- `404` when a pod or GitLab target cannot be found.
- `409` for pod slug conflicts.
- `502` for upstream GitLab failures.

## 11. Reporting Logic

The report is derived from a recent merge-request analysis window and applies the same aggregation rules for ad-hoc and pod scopes.

### KPIs

- Merge requests analyzed.
- Open merge requests.
- Merge requests merged in the last 30 days.
- Median merge time for merged merge requests.
- Active authors, active reviewers, and active projects.

### Queue And Review Signals

- Open queue totals for stale, draft, oversized, and unreviewed work.
- Reviewer concentration share and overloaded reviewer detection.
- Attention flags for stale, oversized, unreviewed, and concentrated-reviewer conditions.

### Coverage And Breakdown

- Requested versus resolved targets.
- Partial-failure reporting when one or more targets fail.
- Deduplicated merge-request contribution counts.
- Per-project breakdown of throughput and queue posture.

## 12. Environment Configuration

### Frontend

- `EIP_BACKEND_BASE_URL`: Base URL for the FastAPI service.

### Backend

- `DATABASE_URL`: SQLAlchemy database URL.
- `GITLAB_BASE_URL`: GitLab host or API base URL.
- `GITLAB_TOKEN`: Backend-only GitLab token.
- `GITLAB_USE_FIXTURES`: Force fixture mode when `true`.
- `GITLAB_ANALYSIS_LIMIT`: Recent merge-request analysis window size.
- `STALE_DAYS_THRESHOLD`: Threshold for stale open work.
- `OVERSIZED_CHANGES_THRESHOLD`: Threshold for oversized merge requests.

## 13. Testing Strategy

- Vitest covers Next proxy routes and the server-side backend client.
- Pytest covers FastAPI endpoints and reporting services.
- Backend live-mode behavior is exercised with `httpx.MockTransport` rather than real GitLab credentials.
- Validation for touched code should include lint, typecheck, frontend tests, and backend tests.

## 14. Exit Criteria

- A user can generate an executive report from a project, group, or saved pod.
- Pod definitions persist in PostgreSQL.
- GitLab credentials never leave the FastAPI runtime.
- The UI exposes grouped operational sections and richer delivery signals.
- The codebase maintains a clean path toward asynchronous jobs, history, and governance.