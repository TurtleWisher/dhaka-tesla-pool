# AI Usage Log

> Running log for the README "AI Usage" section (PRD §8). Add an entry whenever AI output is accepted, changed or rejected.
> Rule for this project: AI proposes, I decide, and I only commit code I can explain.

## Tools

| Tool | Role in this project |
|---|---|
| Claude (Cowork, Claude Enterprise) | Implementation partner: requirements extraction, design drafts, code for one logical feature at a time, tests, explanations |
| ChatGPT (free) | Second opinion: an alternative end-to-end plan, reviews, interview-style questioning |

## Log

| Date | Area | Tool | Suggestion | Decision | Why |
|---|---|---|---|---|---|
| 2026-09-26 | Requirements | Claude | Extract a requirements checklist and traceability matrix from the brief | Accepted (kept as a private working checklist) | Gives every requirement a path to code, test and demo |
| 2026-09-26 | Lifecycle | Claude | Two separate lifecycles (passenger ride request and pool) instead of one | Accepted | One passenger cancelling must not cancel the whole trip |
| 2026-09-26 | Lifecycle | ChatGPT | One shared lifecycle for rides and pools | Rejected | Cannot express "Rafiq cancelled but the pool continues" |
| 2026-09-26 | Concurrency | Claude | Protect the last seat with a one-statement conditional update plus a CHECK constraint | Accepted | Check and write happen in one atomic step; short enough to explain on a whiteboard |
| 2026-09-26 | Concurrency | ChatGPT | Lock the pool row, count members, then insert | Rejected (for now) | Also correct, but more steps and needs raw SQL in Prisma |
| 2026-09-26 | Repo layout | ChatGPT | Name the app folders `backend/` and `frontend/` | Accepted (changed Claude's `apps/api`, `apps/web`) | Clearer for anyone opening the repo |
| 2026-09-26 | Auth | Claude | Keep the login token in `localStorage` and send it as a Bearer header | **Changed**: httpOnly cookie through a Next.js same-origin proxy | Page scripts cannot read the token; no CORS needed |
| 2026-09-26 | Fare | ChatGPT | Fare of ৳80 + ৳12/km with a flat ৳20 pool discount | Rejected | Kept ৳50 + ৳25/km with 20% off: whole-taka answers and a discount that scales with distance |
| 2026-09-26 | Security | Claude | Add `cors` middleware | Dropped after the cookie decision | Same-origin proxy means there are no cross-origin calls to allow |
| 2026-09-26 | Database | Claude | Write partial unique indexes as `status IN (...)` | **Changed** to `status = 'A' OR status = 'B'` | Testing showed PostgreSQL rewrites `IN` into `= ANY (ARRAY[...])`, so Prisma saw drift and tried to recreate the indexes on every migration |
| 2026-09-26 | Database | Claude | Use `prisma migrate diff --from-migrations` in CI | **Changed** to `migrate deploy` + `--from-config-datasource` diff | The first form needs an extra shadow database in Prisma 7 |
| 2026-09-26 | Database | Claude | Keep the seed logic in `src/db/seedCast.ts`, with `prisma/seed.ts` as a thin entry point | Accepted | Tests can call the same seed function directly |
| 2026-09-27 | Auth | Claude | Sign session tokens with `jose` | **Changed** by me to `jsonwebtoken` | The most widely known Node JWT library; easier to recognise and discuss |
| 2026-09-27 | Auth | Claude | Validate request bodies with a `validate(schema)` middleware, as first written in the design | **Changed** to a `parseBody(schema, req.body)` helper called in each handler | Same checks, but TypeScript knows the validated type without an `as` cast |
| 2026-09-27 | Auth | Claude | Also refuse login passwords longer than 72 bytes | Accepted | bcrypt ignores bytes after 72, so a longer string could otherwise match; covered by I-AUTH-02 |
| 2026-09-27 | Auth | Claude | Refuse to start in production with the `.env.example` JWT secret | Accepted | The example value is public on GitHub |
| 2026-09-27 | Logging | Claude | Redact the `set-cookie` response header | Accepted | The Phase 4 request logs showed pino-http writing response headers, so login would have logged session tokens; covered by U-LOG-01 |
| 2026-09-27 | Dependencies | Claude | Do not run `npm audit fix --force` for the 4 high advisories | Accepted | All four are inside the Prisma CLI (`mysql2`, `deepmerge-ts`), not in code the API runs; the forced fix would downgrade Prisma to version 6 (R-23) |
| 2026-09-27 | Rides | Claude | Cursor paging for ride history, as in the design | Accepted by me over "latest 50 only" | Stays correct when new rides arrive between page loads (I-RIDE-06) |
| 2026-09-27 | Rides | Claude | Use the ride id as the cursor (Prisma cursor pagination) instead of encoding `created_at` in it | Accepted | `created_at` is stored to the microsecond but a JavaScript `Date` keeps only milliseconds, so a timestamp cursor could skip rides |
| 2026-09-27 | Domain | Claude | Keep zone and status lists in `domain/` (no Prisma import) with a unit test that they match the database enums | Accepted | The business rules stay free of database code, and the test catches the two lists drifting apart |
| 2026-09-27 | Rides | Claude | Cancel as one conditional update (`WHERE status = 'REQUESTED'`) instead of "read, check, then write" | Accepted | Two cancel clicks racing each other cannot both succeed; covered by a double-click test |

## Candidates for the README

- **Accepted:** the conditional-update seat claim (see `architecture.md` §11).
- **Rejected / changed:** `localStorage` Bearer token replaced by an httpOnly cookie via a same-origin proxy (see `assumptions.md` A-23).
