# Dhaka Tesla Pool

> Share a seat. Split the fare. Survive Dhaka traffic.

An MVP ride-pooling system for Dhaka. Passengers **Nusrat**, **Rafiq** and **Shirin** request rides; driver **Jashim** and his three-seat Tesla **Bullet** carry them. Compatible requests share one Tesla, capacity is never exceeded (even when two people grab the last seat at the same instant), and every passenger pays and sees only their own fare.

**Status:** work in progress. The project foundation is in place (API, web app, database, CI); ride features are being added feature by feature.

## Design documents

| Document | What it contains |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Architecture diagram, ERD, state machines, matching rule, fare model, concurrency strategy, test plan, Git strategy |
| [`docs/assumptions.md`](docs/assumptions.md) | How the parts the brief leaves open are resolved |
| [`docs/ai-usage.md`](docs/ai-usage.md) | Running log of AI suggestions accepted, changed or rejected |

## Project structure

```
backend/     Node.js + Express 5 + TypeScript REST API
frontend/    Next.js (App Router) + Tailwind CSS
docs/        Design documents
docker-compose.yml   PostgreSQL for local development
.env.example         Template for your local .env (never commit .env)
```

## Prerequisites

- Node.js **22.18 or newer** (Node 24 LTS recommended), check with `node -v`
- Docker Desktop, check with `docker --version`
- Git

## Run it locally

```bash
# 1. Environment file (defaults are fine for local development)
cp .env.example .env

# 2. Database
docker compose up -d db
docker compose ps            # wait until db shows "healthy"

# 3. Backend API on http://localhost:4000
cd backend
npm install
npm run dev                  # then open http://localhost:4000/health  ->  {"status":"ok"}

# 4. Frontend on http://localhost:3000 (in a second terminal)
cd frontend
npm install
npm run dev
```

## Tests

```bash
cd backend
npm test            # Vitest + Supertest
npm run typecheck   # TypeScript, no output means no errors
```

GitHub Actions runs the backend type check and tests plus a frontend production build on every pull request.

## Git workflow

`master` holds integrated, working features. Each feature is built on its own `feature/*` branch with small conventional commits (`feat(pool): ...`, `test(pool): ...`) and merged through a pull request with a merge commit. `pre-release` and `release/v1.0.0` are cut near the end. Details: [`docs/architecture.md` §14](docs/architecture.md#14-git-branch-and-commit-strategy).

## AI usage

AI tools are used openly, as the PRD allows. Every accepted, changed or rejected suggestion is logged in [`docs/ai-usage.md`](docs/ai-usage.md); the final summary will be written here.
