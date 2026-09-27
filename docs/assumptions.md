# Assumptions

The brief leaves some behaviour intentionally open. This document records how each open point is resolved, so the implementation stays consistent and every choice can be explained.

Each entry has the same shape: **Assumption** · **Alternatives** · **Why this fits** · **Would change if**. Every assumption is linked to at least one test (test IDs are listed in [`architecture.md`](architecture.md) §12).

---

## A-01 · Geography

- **Assumption.** A fixed list of 9 Dhaka zones: Banani, Gulshan 1, Gulshan 2, Mohakhali, Farmgate, Dhanmondi, Mirpur 10, Uttara, Bashundhara. Zone-to-zone distances come from a documented, symmetric, integer-kilometre table (see `architecture.md` §9.1). Distances are approximate and intentionally round; they are not real routing.
- **Alternatives.** Raw lat/long with haversine distance; a free map (Leaflet + OpenStreetMap tiles); a routing API.
- **Why this fits.** The PRD explicitly says not to fight map APIs and requires fares to be computable by hand. A lookup table makes "Banani → Mohakhali = 3 km" a fact anyone can check, and the same table drives both matching and fares, so there is one source of truth.
- **Would change if.** We needed door-to-door addresses, driver location, or real ETAs. Then: lat/long columns, PostGIS, and a routing provider.

## A-02 · What makes two requests poolable

- **Assumption.** A request can join an existing pool when **all** of these hold:
  1. Same pickup zone as the pool.
  2. Its drop-off zone is within **3 km** (from the table) of the drop-off zone of **every** passenger already in the pool.
  3. The pool is still joinable (status `ACCEPTED`, see A-05).
  4. The pool has at least as many free seats as the request needs.
  5. The passenger is not already in that pool.
- **Alternatives.** Same pickup zone only (too loose: Banani → Uttara would pool with Banani → Mohakhali); same pickup **and** same drop-off (too strict: Nusrat and Rafiq would never pool); detour-ratio rule on an ordered route (more realistic, much harder to test by hand).
- **Why this fits.** Nusrat (→ Mohakhali) and Rafiq (→ Gulshan 1) have destinations 2 km apart, so they pool. A Banani → Gulshan 2 rider would pool with Rafiq (2 km) but **not** with Nusrat (4 km), which gives us a concrete negative test (U-MATCH-03). The "every member" clause stops chains where A is near B and B is near C but A is far from C.
- **Would change if.** Real geometry arrives. Then a detour budget per passenger ("your trip may grow by at most 30%") replaces the destination-radius rule.

## A-03 · Who initiates matching

- **Assumption.** Hybrid, with **one** code path that actually assigns a request to a pool:
  - **Driver path:** Jashim, online and without an active pool, accepts a waiting request. This creates a pool on Bullet with that passenger.
  - **System path:** when a passenger creates a request, the system immediately tries to place it into an existing joinable pool (A-02). If one fits, the request becomes `MATCHED` in the same API call ("about a second", §1).
  - **Sweep on accept:** right after a driver creates a pool, the system tries to place other compatible waiting requests into it, oldest first, until it is full or none fit.
- **Alternatives.** Fully driver-driven (driver hand-picks each co-rider); fully system-driven (system assigns requests to online drivers with no accept step).
- **Why this fits.** §3 requires the driver to "accept a ride/pool", and §1 wants the app to decide pooling almost instantly. The hybrid satisfies both while keeping one guarded function, `assignRequestToPool`, as the only place seats are claimed. That single choke point is what makes the concurrency story defensible.
- **Would change if.** Driver volume made manual accept a bottleneck. Then the system would offer a pool to the best nearby driver with a timeout (dispatch model).

## A-04 · Pools exist only once a driver accepts

- **Assumption.** A pool is always bound to one vehicle and created by a driver accept. There are no driverless "forming" pools.
- **Alternatives.** Form passenger groups first, then offer the group to drivers.
- **Why this fits.** Capacity is a property of a vehicle. Binding the pool to Bullet at creation lets us store a concrete `capacity = 3` and enforce `seats_available ≥ 0` in the database from the first moment.
- **Would change if.** Vehicles had very different capacities and we wanted to optimize group size before dispatch.

## A-05 · Join window

- **Assumption.** New passengers can join only while the pool is `ACCEPTED`. When Jashim marks `DRIVER_ARRIVED`, the roster is locked.
- **Alternatives.** Allow joining until `STARTED`.
- **Why this fits.** §1: "Jashim just wants to know who's actually riding and when he can go." Locking at arrival gives him a stable roster at the curb and removes a class of join-vs-start races.
- **Would change if.** Data showed many near-miss pools at the curb.

## A-06 · Seats per request and multi-seat pricing

- **Assumption.** A request asks for 1 to 3 seats (validated by Zod and a DB CHECK; also must fit the pool). Fare is charged **per seat**. A single request with 2 seats is **not** a pool by itself; "pooled" means at least two distinct requests share the vehicle at start.
- **Alternatives.** Single-seat requests only; flat fare regardless of seats.
- **Why this fits.** §3 lists "seats" as a passenger input, so it must exist. Per-seat pricing stops one person holding 3 seats for the price of 1.
- **Would change if.** The product wanted group discounts.

## A-07 · Estimated vs final fare

- **Assumption.**
  - At request time the passenger sees the **solo estimate** (no discount), which is the maximum they can pay.
  - Once matched, the UI shows a **live estimate** that includes the pool discount if another request is in the pool right now.
  - At `STARTED` the fare is **locked**: base, distance charge, discount and total are written to the request row and never change afterwards.
- **Alternatives.** Lock at match time; charge solo price and refund later.
- **Why this fits.** The discount depends on who is actually in the car. `STARTED` is the moment the roster is final and nobody can cancel (A-11), so it is the only honest moment to lock.
- **Would change if.** Regulations required a binding upfront price. Then we would lock the solo price at request and apply the discount as a guaranteed maximum.

## A-08 · Co-rider cancels before start

- **Assumption.** If Rafiq cancels before start and Nusrat ends up alone, Nusrat's fare at start is the solo fare. Her live estimate updates immediately.
- **Alternatives.** Keep the discount as a promise once shown.
- **Why this fits.** A pool discount pays for a shared ride. It is consistent and trivially testable (I-CANCEL-02).
- **Would change if.** User research showed this feels unfair; the fix would be "discount promised at match is honoured".

## A-09 · Rounding

- **Assumption.** All money is integer poysha (1 taka = 100 poysha). Every computed charge uses integer arithmetic with explicit half-up rounding to the nearest poysha. With the constants in A-29 and whole-kilometre distances, no rounding ever occurs in practice; the rule exists so the function is total and tested (U-FARE-04).
- **Alternatives.** Round to whole taka for cash handling.
- **Why this fits.** Keeps the fare function exact and hand-checkable.
- **Would change if.** Cash handling required whole-taka totals; that would be a separate display/collection rule, not a storage change.

## A-10 · Payment

- **Assumption.** Cash only. Each request stores `payment_method = CASH`. Completing the pool means the driver collected cash. No wallet, no balance, no payment table.
- **Alternatives.** Simulated TeslaPay wallet with balances and ledger entries.
- **Why this fits.** A wallet adds a ledger, balance integrity and more concurrency surface, and none of it is scored. The enum leaves room to add `TESLAPAY` later.
- **Would change if.** The evaluator asks for wallet flows, or payment becomes part of the demo story.

## A-11 · Cancellation rules

- **Assumption.**
  - A passenger can cancel their **own** request while it is `REQUESTED` or `MATCHED` (pool not yet `STARTED`). Seats are released in the same transaction.
  - After `STARTED`, cancellation is rejected with `409`.
  - No cancellation fee.
  - If the last active passenger leaves a not-yet-started pool, the pool becomes `CANCELLED` automatically and the driver is free again.
  - A driver can cancel a pool before `STARTED`. Its passengers are **returned to `REQUESTED`** (re-queued, not cancelled), because they did nothing wrong. The event log records this.
- **Alternatives.** Cancellation fee after match; driver cancel cancels passengers too.
- **Why this fits.** Clear, testable windows. Re-queuing respects the passenger's intent.
- **Would change if.** Abuse (serial cancelling) appeared; add fees or cooldowns.

## A-12 · One active request per passenger

- **Assumption.** A passenger can have at most one request in `REQUESTED`, `MATCHED` or `IN_PROGRESS`. Enforced by a partial unique index, not only by application code.
- **Alternatives.** Allow multiple (booking for others).
- **Why this fits.** Prevents double-submit duplicates and keeps status tracking unambiguous.
- **Would change if.** Booking on behalf of others became a feature.

## A-13 · Driver onboarding

- **Assumption.** Drivers and vehicles are seeded (Jashim + Bullet). The public `register` endpoint always creates a `PASSENGER`; any `role` field in the body is ignored.
- **Alternatives.** Driver self-signup with vehicle registration.
- **Why this fits.** §3 gives passengers "sign up/in" but drivers only "sign in". Driver onboarding (licences, vehicle checks) is out of MVP scope, and ignoring `role` closes a mass-assignment hole (I-AUTH-03).
- **Would change if.** An admin or driver onboarding flow is added.

## A-14 · Vehicles and pools per driver

- **Assumption.** One vehicle per driver; at most one active pool (`ACCEPTED`, `DRIVER_ARRIVED`, `STARTED`) per vehicle, enforced by a partial unique index.
- **Alternatives.** Drivers switching between vehicles.
- **Why this fits.** Matches the story; simple invariant.
- **Would change if.** Fleet operators shared vehicles between drivers.

## A-15 · Online / offline

- **Assumption.** An offline driver sees no requests and cannot accept. A driver cannot go offline while holding an active pool (`409`). Going online records no location.
- **Alternatives.** Allow going offline mid-pool.
- **Why this fits.** Prevents orphaned passengers.
- **Would change if.** Driver location tracking is added.

## A-16 · "Relevant requests" for a driver

- **Assumption.**
  - Online, no active pool: all `REQUESTED` requests, oldest first.
  - Active pool in `ACCEPTED`: only waiting requests that pass the matching rule for that pool and fit its free seats.
  - Pool in `DRIVER_ARRIVED` or `STARTED`: none.
- **Alternatives.** Filter by driver's current zone.
- **Why this fits.** There is no driver location (A-15), so relevance means "this driver could actually take this request".
- **Would change if.** Driver location exists; then filter by distance to pickup.

## A-17 · What a passenger sees about co-riders

- **Assumption.** A passenger sees: that they are pooled, how many other riders/seats are in the car, the driver's name and vehicle, and **their own** fare and status. They do **not** see co-riders' names, destinations or fares.
- **Alternatives.** Show co-rider first names.
- **Why this fits.** The brief (§2) says each passenger sees their own fare and status, "not anyone else's", and its story (§1) jokes about not accidentally making a new friend. The count still makes pool membership obvious (POOL-05).
- **Would change if.** Safety features wanted co-rider identity shared.

## A-18 · Driver sees fares

- **Assumption.** The driver sees each passenger's name, seats, drop-off zone and (live or locked) fare.
- **Alternatives.** Driver sees totals only.
- **Why this fits.** Cash collection (A-10) requires knowing who owes what.
- **Would change if.** Payments became cashless.

## A-19 · Request expiry

- **Assumption.** No automatic expiry in the MVP. Waiting requests stay `REQUESTED` until matched or cancelled. Listed as a known limitation.
- **Alternatives.** Expire after N minutes via a scheduled job or lazily on read.
- **Why this fits.** A background job is extra moving parts for little value in a demo.
- **Would change if.** Stale requests became visible noise. A lazy expiry check on read is the cheapest next step.

## A-20 · Drop-off order and completion

- **Assumption.** Drop-off order is not modelled. "Complete trip" completes the whole pool and all its active requests at once.
- **Alternatives.** Per-passenger drop-off events.
- **Why this fits.** §3 lists a single "complete trip" action. Per-passenger drop-off adds sub-states without new insight.
- **Would change if.** Fares depended on actual time in the car.

## A-21 · Canonical scenarios (story vs §12)

- **Assumption.** Two scenarios, both using the cast:
  - **Story / demo (sequential):** Nusrat (1 seat, Banani → Mohakhali) → Jashim accepts → Rafiq (1 seat, Banani → Gulshan 1) auto-matches → Shirin (1 seat, Banani → Gulshan 1) takes the last seat → Bullet 3/3.
  - **Concurrency test (§12 literal):** Jashim's pool holds Rafiq with **2 seats**, leaving 1. Nusrat and Shirin (both Banani, 1 seat, compatible destinations) submit at the same instant. Exactly one is matched; the other stays waiting.
- **Alternatives.** Use only the story ordering and race Shirin against a new character.
- **Why this fits.** §12 names Nusrat and Shirin explicitly, and the 2-seat booking exercises A-06 at the same time.
- **Would change if.** The race is better demonstrated with the story ordering.

## A-22 · Losing a seat race

- **Assumption.** On the **system path**, losing is not an error: the request is created and stays `REQUESTED` ("waiting for a Tesla"), and it is still visible to drivers. On the **driver path**, accepting a request that another transaction already claimed returns `409 REQUEST_ALREADY_MATCHED`.
- **Alternatives.** Return an error to the passenger.
- **Why this fits.** From the passenger's point of view nothing failed; they are simply not matched yet.
- **Would change if.** Passengers needed guaranteed immediate matches.

## A-23 · Authentication tokens

- **Assumption.** Email + password, bcrypt hashing. Stateless JWT (HS256), 8-hour expiry, stored in an **httpOnly cookie** (`dtp_session`, `SameSite=Lax`, `Secure` in production, `Path=/`). The browser only ever talks to the Next.js origin; Next.js forwards `/api/*` to Express, so the cookie is first-party. Logout clears the cookie. No refresh token and no server-side revocation in the MVP.
- **CSRF.** `SameSite=Lax` stops the browser sending the cookie on cross-site `POST`s; the API additionally rejects state-changing requests whose `Origin` header is not the frontend's origin.
- **Alternatives.** Bearer token in `localStorage` (simpler, but readable by any injected script); server-side sessions table.
- **Why this fits.** Page scripts cannot read the token, which removes the main XSS token-theft risk, and the same-origin proxy also means no CORS configuration. Supertest (`request.agent`) and Playwright both handle cookies natively, so testability is unchanged.
- **Would change if.** Real users: add short-lived access tokens with a rotating refresh token and a revocation list.

## A-24 · Out of scope

Ratings, admin role, push/SMS notifications, real payments or wallet, maps, surge/traffic/weather pricing, driver location, scheduled rides, multi-language UI. Each is listed in README "Next improvements".

## A-25 · Time

Timestamps stored as `timestamptz` in UTC using database `now()`. Displayed in `Asia/Dhaka`.

## A-26 · Capacity changes

A pool copies the vehicle's capacity at creation (`pools.capacity`). Changing a vehicle's capacity (no UI for it in the MVP) affects only future pools, so an active pool's invariant can never be broken retroactively.

## A-27 · Real-time updates

Polling every 5 seconds on active-ride screens only; manual refresh elsewhere. No WebSockets or SSE in the MVP. Justified in `architecture.md` §5 (D-03).

## A-28 · Second driver for authorization tests

- **Problem.** Authorization tests need "driver X cannot act on driver Y's pool", but the story cast has only one driver, Jashim, and generic placeholders like `driver2` would break the story.
- **Assumption.** **Mokbul**, Jashim's rival, drives a Tesla called **Toofan** ("storm"). He exists only in integration-test fixtures, **never** in seed data, the demo or README credentials.
- **Alternative rejected.** Skipping driver-vs-driver authorization tests, which would leave a gap in authorization coverage.

## A-29 · Fare constants

- **Assumption.** `BASE_FARE = 5000` poysha (৳50) per seat, `RATE_PER_KM = 2500` poysha (৳25), `POOL_DISCOUNT = 20%` (2000 basis points) applied when at least two distinct requests share the pool at start.
- **Result for the story.** Nusrat solo ৳125.00, pooled ৳100.00. Rafiq solo ৳150.00, pooled ৳120.00. Full working in `architecture.md` §10.3.
- **Alternatives.** Discount scaling with number of riders; fixed-amount discount.
- **Why this fits.** Whole-taka pooled fares make the hand check instant for an evaluator.
- **Would change if.** Real pricing data. Constants live in one config module and each locked fare stores its breakdown, so changing them never rewrites history.

## A-30 · Sign-up rules

- **Assumption.** Name (1 to 80 characters), email and password. Emails are trimmed and stored in lowercase, so `Nusrat@TeslaPool.test` and `nusrat@teslapool.test` are the same account. Passwords need at least 8 characters and at most 72 bytes (bcrypt's limit). Registering an email that already exists returns `409 EMAIL_TAKEN` with the message "This email is already registered".
- **Alternatives.** Answering "check your email" for both new and existing addresses, which hides whether an account exists.
- **Why this fits.** There is no email sending in the MVP, so a hidden answer would leave a user unable to find out why they cannot sign in. Revealing that an email is registered is common practice; the rate limit on `/auth/register` stops anyone checking addresses in bulk. Login, where probing matters more, never reveals it.
- **Would change if.** Email verification is added: then sign-up can always answer "check your inbox".
- **Tests.** I-AUTH-08 (validation, lowercase email, duplicate email), I-AUTH-07 (rate limit).
