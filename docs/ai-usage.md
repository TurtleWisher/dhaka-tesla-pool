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

## Candidates for the README

- **Accepted:** the conditional-update seat claim (see `architecture.md` §11).
- **Rejected / changed:** `localStorage` Bearer token replaced by an httpOnly cookie via a same-origin proxy (see `assumptions.md` A-23).
