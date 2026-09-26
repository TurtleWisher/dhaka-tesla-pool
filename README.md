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
npm install                  # also generates the Prisma client
npm run db:migrate           # create/update the tables
npm run db:seed              # add Jashim, Bullet, Nusrat, Rafiq and Shirin
npm run dev                  # then open http://localhost:4000/health  ->  {"status":"ok","database":"ok"}

# 4. Frontend on http://localhost:3000 (in a second terminal)
cd frontend
npm install
npm run dev
```

## Database

PostgreSQL 17 (Docker) accessed through Prisma 7. The schema is in [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma); the ERD and the reasoning for every table are in [`docs/architecture.md` §7](docs/architecture.md#7-database-design-and-erd).

| Command (in `backend/`) | What it does |
|---|---|
| `npm run db:migrate` | Applies migrations in development (and creates a new one after a schema change) |
| `npm run db:deploy` | Applies existing migrations only (CI, Docker, production) |
| `npm run db:seed` | Creates or updates the story cast; safe to run repeatedly |
| `npm run db:studio` | Opens Prisma Studio, a browser view of the tables |
| `npm run db:generate` | Regenerates the typed Prisma client (runs automatically on `npm install`) |

Integrity rules are enforced by the database itself, not only by code: CHECK constraints (seat counter between 0 and capacity, pickup different from drop-off, 1 to 3 seats, fare breakdown adds up) and partial unique indexes (one active pool per vehicle, one active request per passenger, one active pool membership per request).

### Demo accounts

All seeded accounts use the password `TeslaPool#2026` (demo only).

| Name | Role | Email |
|---|---|---|
| Jashim | Driver of Bullet (3 seats) | `jashim@teslapool.test` |
| Nusrat | Passenger | `nusrat@teslapool.test` |
| Rafiq | Passenger | `rafiq@teslapool.test` |
| Shirin | Passenger | `shirin@teslapool.test` |

## Tests

```bash
cd backend
npm test            # Vitest + Supertest, against a separate test database
npm run typecheck   # TypeScript, no output means no errors
```

Tests never touch the development database: they use `TEST_DATABASE_URL`, which is created and migrated automatically before the suite runs and emptied before each test.

GitHub Actions runs, on every pull request: the backend type check, all migrations on a fresh PostgreSQL, a schema-vs-migrations drift check, the backend tests, and a frontend production build.

## Git workflow

`master` holds integrated, working features. Each feature is built on its own `feature/*` branch with small conventional commits (`feat(pool): ...`, `test(pool): ...`) and merged through a pull request with a merge commit. `pre-release` and `release/v1.0.0` are cut near the end. Details: [`docs/architecture.md` §14](docs/architecture.md#14-git-branch-and-commit-strategy).

## AI usage

AI tools are used openly, as the PRD allows. Every accepted, changed or rejected suggestion is logged in [`docs/ai-usage.md`](docs/ai-usage.md); the final summary will be written here.
