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

Already have a `.env` from an earlier version? Compare it with `.env.example` and copy any new lines: the API refuses to start without a valid `JWT_SECRET`.

### Settings

All settings live in the root `.env` (template: [`.env.example`](.env.example)) and are validated when the API starts.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | none (required) | Development database |
| `TEST_DATABASE_URL` | none (required for tests) | Separate database for automated tests |
| `JWT_SECRET` | none (required, 32+ characters) | Signs session tokens. The example value is refused in production |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | The only origin allowed to send POST requests |
| `BCRYPT_COST` | `12` | Password hashing cost (4 to 15) |
| `AUTH_RATE_LIMIT_MAX` | `10` | Login/register attempts per IP address per 15 minutes |
| `PORT`, `LOG_LEVEL` | `4000`, `info` | API port and log detail |

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

## API

All endpoints live under `/api/v1` (health check: `GET /health`). Errors always have the same shape: `{ "error": { "code": "...", "message": "...", "details"?: {...} } }`.

### Authentication

| Method | Path | Who | What it does |
|---|---|---|---|
| POST | `/api/v1/auth/register` | anyone | Creates a **passenger** account (`name`, `email`, `password`) and signs in. Any `role` sent is ignored |
| POST | `/api/v1/auth/login` | anyone | Signs in a passenger or a driver (`email`, `password`) |
| POST | `/api/v1/auth/logout` | anyone | Signs out (expires the cookie) |
| GET | `/api/v1/auth/me` | signed in | The current user: `id`, `name`, `email`, `role` |

Signing in sets a `dtp_session` cookie: **httpOnly** (page scripts cannot read it), **SameSite=Lax**, valid for 8 hours, and **Secure** in production. It holds a signed token with the user id and role only. Passwords are stored only as bcrypt hashes.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing or invalid; `details` names each field. Passwords need 8 characters to 72 bytes |
| 401 | `INVALID_CREDENTIALS` | Wrong email **or** password (the same answer for both, on purpose) |
| 401 | `UNAUTHENTICATED` | No session, or an invalid or expired one |
| 403 | `BAD_ORIGIN` | A POST that did not come from the web app (`FRONTEND_ORIGIN`) |
| 409 | `EMAIL_TAKEN` | Registering an email that already has an account |
| 429 | `RATE_LIMITED` | Too many login/register attempts from one address (10 per 15 minutes by default) |

Try it with `curl`. POST requests must carry the web app's `Origin` header, exactly like a browser would:

```bash
curl -i -c cookies.txt -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
  -d '{"email":"jashim@teslapool.test","password":"TeslaPool#2026"}' \
  http://localhost:4000/api/v1/auth/login

curl -b cookies.txt http://localhost:4000/api/v1/auth/me
```

### Zones and fares

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/zones` | signed in | The 9 zones: `{ "zones": [{ "id": "BANANI", "name": "Banani" }, ...] }` |
| GET | `/api/v1/fares/estimate?pickup=BANANI&dropoff=MOHAKHALI&seats=1` | passenger | Distance plus the `solo` and `pooled` fare breakdowns; nothing is booked. `seats` defaults to 1 |

Fares are ৳50 base plus ৳25 per km, **per seat**, with 20% off when the car is shared. All money in the API is in **poysha** (৳1 = 100 poysha): Banani → Mohakhali (3 km) is `12500` solo and `10000` pooled.

### Rides (passengers)

| Method | Path | What it does |
|---|---|---|
| POST | `/api/v1/rides` | Request a ride: `{ "pickupZone": "BANANI", "dropoffZone": "MOHAKHALI", "seats": 1 }` → 201 with the ride (`REQUESTED`, distance, solo estimate) |
| GET | `/api/v1/rides/current` | Your active ride, or `{ "ride": null }` |
| GET | `/api/v1/rides?limit=20&cursor=<id>` | Your ride history, newest first. Pass the returned `nextCursor` to get the next page; it is `null` on the last page |
| GET | `/api/v1/rides/:id` | One of your rides, with its history (`events`) |
| POST | `/api/v1/rides/:id/cancel` | Cancel your ride while it is still waiting (`REQUESTED`) |

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Same pickup and drop-off, an unknown zone, seats not 1 to 3, a bad `limit` or `cursor` |
| 403 | `FORBIDDEN_ROLE` | A driver calling a passenger endpoint |
| 404 | `NOT_FOUND` | The ride does not exist **or belongs to someone else** (the same answer on purpose) |
| 409 | `ACTIVE_REQUEST_EXISTS` | You already have an active ride; `details.rideId` says which |
| 409 | `INVALID_TRANSITION`, `RIDE_ALREADY_STARTED` | The ride can no longer be cancelled |

```bash
curl -b cookies.txt -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
  -d '{"pickupZone":"BANANI","dropoffZone":"MOHAKHALI"}' http://localhost:4000/api/v1/rides
```

(Log in as a passenger first, e.g. `nusrat@teslapool.test`; drivers get 403.)

## Tests

```bash
cd backend
npm test            # unit tests (pure functions) + integration tests (Supertest, separate test database)
npm run typecheck   # TypeScript, no output means no errors
```

Tests never touch the development database: they use `TEST_DATABASE_URL`, which is created and migrated automatically before the suite runs and emptied before each test.

GitHub Actions runs, on every pull request: the backend type check, all migrations on a fresh PostgreSQL, a schema-vs-migrations drift check, the backend tests, and a frontend production build.

## Git workflow

`master` holds integrated, working features. Each feature is built on its own `feature/*` branch with small conventional commits (`feat(pool): ...`, `test(pool): ...`) and merged through a pull request with a merge commit. `pre-release` and `release/v1.0.0` are cut near the end. Details: [`docs/architecture.md` §14](docs/architecture.md#14-git-branch-and-commit-strategy).

## AI usage

AI tools are used openly, as the PRD allows. Every accepted, changed or rejected suggestion is logged in [`docs/ai-usage.md`](docs/ai-usage.md); the final summary will be written here.
