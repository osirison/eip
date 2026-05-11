# EIP Delivery Intelligence

This repository delivers a browser-facing Next.js application backed by a FastAPI service and PostgreSQL persistence for GitLab delivery reporting. The frontend owns the workbench UI and thin proxy routes, while the backend owns pod persistence, GitLab access, fixture or live mode, and report aggregation.

## What Is Included

- Next.js App Router UI with a GitLab-inspired reporting workbench
- FastAPI backend for pods, ad-hoc reports, and aggregated pod reports
- PostgreSQL-backed pod persistence with Alembic migrations
- Fixture-backed development mode and live GitLab mode behind the backend boundary
- Automated tests for Next proxy routes, backend client behavior, FastAPI endpoints, and reporting services

## Architecture

- Next.js remains the only browser-facing app.
- Browser requests go through `/api/report`, `/api/pods`, `/api/pods/:podId`, and `/api/pods/:podId/report`.
- FastAPI serves `/v1/reports/*`, `/v1/pods/*`, and `/healthz`.
- GitLab credentials stay in `backend/.env` only.

## Local Run

1. Install frontend dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
cd backend
python3 -m pip install -e '.[dev]'
cd ..
```

3. Copy the environment templates:

```bash
cp .env.example .env.local
cp backend/.env.example backend/.env
```

4. Start PostgreSQL:

```bash
docker compose up -d postgres
```

5. Apply database migrations:

```bash
cd backend
alembic upgrade head
cd ..
```

6. Optionally seed the default development pod:

```bash
cd backend
python scripts/seed_dev_data.py
cd ..
```

7. Start the backend:

```bash
cd backend
uvicorn app.main:app --reload
```

8. In a second terminal, start the frontend:

```bash
npm run dev
```

9. Open `http://localhost:3000`.

## Environment Variables

Frontend:

- `EIP_BACKEND_BASE_URL`: Base URL for the FastAPI service. Defaults to `http://127.0.0.1:8000`.

Backend:

- `DATABASE_URL`: SQLAlchemy connection string for PostgreSQL.
- `GITLAB_BASE_URL`: GitLab host or API base URL. If `/api/v4` is missing, the backend appends it automatically.
- `GITLAB_TOKEN`: GitLab token used only by FastAPI in live mode.
- `GITLAB_USE_FIXTURES`: Set to `true` to force fixture mode. If the token is missing, the backend also falls back to fixtures automatically.
- `GITLAB_ANALYSIS_LIMIT`: Number of recent merge requests to analyze per target.
- `STALE_DAYS_THRESHOLD`: Open merge-request age threshold for stale attention flags.
- `OVERSIZED_CHANGES_THRESHOLD`: Changed-lines threshold for oversized attention flags.

## Agent Hook Notification

- Export `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the local environment that launches VS Code if you want the workspace `Stop` hook to send a Telegram notification after an agent run completes.
- `TELEGRAM_API_BASE_URL` is optional and only intended for local mock or proxy testing of the hook.
- The hook reads those values directly from the local environment, keeps temporary session state outside the repo, includes a sanitized first-prompt title, final-answer outcome summary, and elapsed time, and fails open on missing config or Telegram/API errors.

## Validation

```bash
npm run lint
npm run typecheck
npm test
cd backend && pytest
```

## Notes

- Local PostgreSQL defaults are defined in `docker-compose.yml` and `backend/.env.example`.
- The current and future-state architecture is documented in `docs/technical-design.md`.
