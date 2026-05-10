# EIP GitLab Reporting POC

This repository contains a single-app Next.js proof of concept for executive GitLab reporting. The app accepts a GitLab Project ID or Group ID, pulls recent merge-request activity on the server, and renders a concise executive report.

## What Is Included

- Next.js App Router application
- Tailwind and Shadcn-friendly UI structure
- Server-side GitLab integration using environment variables
- Fixture fallback for local development without live credentials
- Targeted unit tests for aggregation logic

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and update values as needed:

```bash
cp .env.example .env.local
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Environment Variables

- `GITLAB_BASE_URL`: GitLab host or API base URL. If `/api/v4` is missing, the app appends it automatically.
- `GITLAB_TOKEN`: GitLab token used only on the server.
- `GITLAB_USE_FIXTURES`: Set to `true` to force fixture mode. If the token is missing, the app also falls back to fixtures automatically.

## Validation

```bash
npm run lint
npm run typecheck
npm test
```

## Notes

- The target-state architecture remains documented in `docs/technical-design.md`.
- The POC intentionally defers FastAPI, PostgreSQL, Redis, Celery, Copilot ingestion, Ask Your Data, permissions, and enterprise hardening.