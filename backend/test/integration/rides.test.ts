import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { ORIGIN, createTestApp } from '../helpers/app.js';
import { type SignedInAgent, signIn } from '../helpers/auth.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);

let nusrat: SignedInAgent;
let rafiq: SignedInAgent;
let jashim: SignedInAgent;

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma, { bcryptCost: 4 });
  [nusrat, rafiq, jashim] = await Promise.all([
    signIn(app, 'nusrat@teslapool.test'),
    signIn(app, 'rafiq@teslapool.test'),
    signIn(app, 'jashim@teslapool.test'),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Nusrat's trip from the story: Banani to Mohakhali, 1 seat. */
const toMohakhali = { pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', seats: 1 };

const requestRide = (agent: SignedInAgent, body: object = toMohakhali) =>
  agent.post('/api/v1/rides').set('Origin', ORIGIN).send(body);

describe('POST /api/v1/rides', () => {
  it('[I-RIDE-04] creates a waiting ride with its distance and solo estimate, and logs it', async () => {
    const res = await requestRide(nusrat);

    expect(res.status).toBe(201);
    expect(res.body.ride).toMatchObject({
      status: 'REQUESTED',
      pickupZone: 'BANANI',
      dropoffZone: 'MOHAKHALI',
      seats: 1,
      distanceM: 3000,
      estimatedFarePoysha: 12500, // ৳125 solo
      fare: null, // not locked until the trip starts
      matchedAt: null,
    });

    const events = await prisma.rideEvent.findMany({ where: { rideRequestId: res.body.ride.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'REQUEST_CREATED', toStatus: 'REQUESTED' });
  });

  it('[I-RIDE-04] defaults to 1 seat and prices 2 seats per seat', async () => {
    const oneSeat = await requestRide(nusrat, { pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI' });
    const twoSeats = await requestRide(rafiq, { pickupZone: 'BANANI', dropoffZone: 'GULSHAN_1', seats: 2 });

    expect(oneSeat.body.ride.seats).toBe(1);
    expect(twoSeats.body.ride.estimatedFarePoysha).toBe(30000); // 2 × ৳150 solo
  });

  it('[I-RIDE-01] explains every invalid request with 400', async () => {
    const cases = [
      [{ pickupZone: 'BANANI', dropoffZone: 'BANANI' }, 'dropoffZone', 'Drop-off must be different from pickup'],
      [{ pickupZone: 'MOTIJHEEL', dropoffZone: 'BANANI' }, 'pickupZone', 'Choose one of the 9 zones'],
      [{ ...toMohakhali, seats: 0 }, 'seats', 'Choose 1 to 3 seats'],
      [{ ...toMohakhali, seats: 4 }, 'seats', 'Choose 1 to 3 seats'],
      [{ ...toMohakhali, seats: 1.5 }, 'seats', 'Choose 1 to 3 seats'],
      [{ ...toMohakhali, seats: '2' }, 'seats', 'Choose 1 to 3 seats'], // JSON numbers only
    ] as const;

    for (const [body, field, message] of cases) {
      const res = await requestRide(nusrat, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.details[field]).toEqual([message]);
    }
    expect(await prisma.rideRequest.count()).toBe(0);
  });

  it('[I-RIDE-02] refuses a second active ride with 409 and says which ride is active', async () => {
    const first = await requestRide(nusrat);

    const second = await requestRide(nusrat, { pickupZone: 'BANANI', dropoffZone: 'UTTARA' });

    expect(second.status).toBe(409);
    expect(second.body.error).toEqual({
      code: 'ACTIVE_REQUEST_EXISTS',
      message: 'You already have an active ride request',
      details: { rideId: first.body.ride.id },
    });
    // Rafiq is not affected by Nusrat's ride.
    expect((await requestRide(rafiq)).status).toBe(201);
  });

  it('[I-RIDE-02] a double click creates exactly one ride', async () => {
    const [a, b] = await Promise.all([requestRide(nusrat), requestRide(nusrat)]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.rideRequest.count()).toBe(1);
    expect(await prisma.rideEvent.count()).toBe(1); // the losing request left no history behind
  });

  it('[I-AUTH-04] is for passengers only, signed in, from the app', async () => {
    const asDriver = await requestRide(jashim);
    const anonymous = await request(app).post('/api/v1/rides').set('Origin', ORIGIN).send(toMohakhali);
    const foreign = await nusrat.post('/api/v1/rides').set('Origin', 'https://evil.example').send(toMohakhali);

    expect(asDriver.status).toBe(403);
    expect(asDriver.body.error.code).toBe('FORBIDDEN_ROLE');
    expect(anonymous.status).toBe(401);
    expect(foreign.status).toBe(403);
    expect(await prisma.rideRequest.count()).toBe(0);
  });
});

describe('GET /api/v1/rides/current', () => {
  it('[I-RIDE-05] is null before a request and the active ride after it, for its owner only', async () => {
    expect((await nusrat.get('/api/v1/rides/current')).body).toEqual({ ride: null });

    const created = await requestRide(nusrat);
    const current = await nusrat.get('/api/v1/rides/current');

    expect(current.status).toBe(200);
    expect(current.body.ride.id).toBe(created.body.ride.id);
    expect((await rafiq.get('/api/v1/rides/current')).body).toEqual({ ride: null });
  });
});

/** Ends every active ride of this passenger, so the next request is allowed (test setup only). */
const finishActiveRides = (email: string) =>
  prisma.rideRequest.updateMany({
    where: { passenger: { email }, status: 'REQUESTED' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

describe('GET /api/v1/rides (history)', () => {
  /** Nusrat's three trips, oldest first. */
  async function threeRides(): Promise<string[]> {
    const ids: string[] = [];
    for (const dropoffZone of ['MOHAKHALI', 'GULSHAN_1', 'UTTARA']) {
      const res = await requestRide(nusrat, { pickupZone: 'BANANI', dropoffZone });
      ids.push(res.body.ride.id);
      await finishActiveRides('nusrat@teslapool.test');
    }
    return ids;
  }

  it('[I-RIDE-06] pages through the rides newest first, then says there is nothing more', async () => {
    const [first, second, third] = await threeRides();

    const page1 = await nusrat.get('/api/v1/rides?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.rides.map((r: { id: string }) => r.id)).toEqual([third, second]);
    expect(page1.body.nextCursor).toBe(second);

    const page2 = await nusrat.get(`/api/v1/rides?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.rides.map((r: { id: string }) => r.id)).toEqual([first]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('[I-RIDE-06] does not repeat or skip rides when a new one arrives between pages', async () => {
    const [first, second, third] = await threeRides();
    const page1 = await nusrat.get('/api/v1/rides?limit=2');

    const newest = (await requestRide(nusrat, { pickupZone: 'BANANI', dropoffZone: 'DHANMONDI' })).body.ride.id;
    const page2 = await nusrat.get(`/api/v1/rides?limit=2&cursor=${page1.body.nextCursor}`);

    expect(page1.body.rides.map((r: { id: string }) => r.id)).toEqual([third, second]);
    expect(page2.body.rides.map((r: { id: string }) => r.id)).toEqual([first]); // not "second" again
    expect((await nusrat.get('/api/v1/rides')).body.rides[0].id).toBe(newest);
  });

  it('[I-AUTHZ-01] shows each passenger only their own rides', async () => {
    await threeRides();

    const rafiqs = await rafiq.get('/api/v1/rides');

    expect(rafiqs.body).toEqual({ rides: [], nextCursor: null });
  });

  it('[I-RIDE-06] refuses a bad limit or cursor with 400, including another passenger\'s ride id', async () => {
    const rafiqsRide = (await requestRide(rafiq)).body.ride.id;

    const tooMany = await nusrat.get('/api/v1/rides?limit=51');
    const garbage = await nusrat.get('/api/v1/rides?cursor=not-a-ride');
    const notHers = await nusrat.get(`/api/v1/rides?cursor=${rafiqsRide}`);

    expect(tooMany.body.error.details).toEqual({ limit: ['limit must be 1 to 50'] });
    for (const res of [garbage, notHers]) {
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ cursor: ['cursor must be a nextCursor value from a previous page'] });
    }
  });
});

describe('GET /api/v1/rides/:id', () => {
  it('[I-RIDE-07] shows the passenger their ride and its history', async () => {
    const created = (await requestRide(nusrat)).body.ride;

    const res = await nusrat.get(`/api/v1/rides/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.body.ride).toMatchObject({ id: created.id, status: 'REQUESTED', estimatedFarePoysha: 12500 });
    expect(res.body.ride.events).toEqual([
      { type: 'REQUEST_CREATED', fromStatus: null, toStatus: 'REQUESTED', createdAt: expect.any(String) },
    ]);
  });

  it('[I-AUTHZ-01] Rafiq gets the same 404 for Nusrat\'s ride as for a ride that does not exist', async () => {
    const nusratsRide = (await requestRide(nusrat)).body.ride.id;

    const hers = await rafiq.get(`/api/v1/rides/${nusratsRide}`);
    const nobodys = await rafiq.get('/api/v1/rides/00000000-0000-4000-8000-000000000000');
    const malformed = await rafiq.get('/api/v1/rides/42');

    for (const res of [hers, nobodys, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Ride not found' } });
    }
  });
});

describe('POST /api/v1/rides/:id/cancel', () => {
  const cancel = (agent: SignedInAgent, rideId: string) =>
    agent.post(`/api/v1/rides/${rideId}/cancel`).set('Origin', ORIGIN);

  it('[I-CANCEL-01] cancels a waiting ride, logs it, and lets Nusrat request again', async () => {
    const ride = (await requestRide(nusrat)).body.ride;

    const res = await cancel(nusrat, ride.id);

    expect(res.status).toBe(200);
    expect(res.body.ride).toMatchObject({ id: ride.id, status: 'CANCELLED', cancelledAt: expect.any(String) });
    const detail = await nusrat.get(`/api/v1/rides/${ride.id}`);
    expect(detail.body.ride.events.map((e: { type: string }) => e.type)).toEqual([
      'REQUEST_CREATED',
      'REQUEST_CANCELLED',
    ]);
    expect(detail.body.ride.events[1]).toMatchObject({ fromStatus: 'REQUESTED', toStatus: 'CANCELLED' });
    expect((await nusrat.get('/api/v1/rides/current')).body.ride).toBeNull();
    expect((await requestRide(nusrat)).status).toBe(201);
  });

  it('[I-CANCEL-01] a double click cancels once: the second click gets 409 and no second event', async () => {
    const ride = (await requestRide(nusrat)).body.ride;

    const [a, b] = await Promise.all([cancel(nusrat, ride.id), cancel(nusrat, ride.id)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.rideEvent.count({ where: { type: 'REQUEST_CANCELLED' } })).toBe(1);
  });

  it('[I-CANCEL-01] refuses to cancel a ride that is already cancelled', async () => {
    const ride = (await requestRide(nusrat)).body.ride;
    await cancel(nusrat, ride.id);

    const again = await cancel(nusrat, ride.id);

    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({
      code: 'INVALID_TRANSITION',
      message: 'A cancelled ride cannot be cancelled',
      details: { from: 'CANCELLED', to: 'CANCELLED' },
    });
  });

  it('[I-CANCEL-03] refuses to cancel once the trip has started', async () => {
    const ride = (await requestRide(nusrat)).body.ride;
    // The trip-start flow comes with the driver phase; here the database is set directly.
    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: 'IN_PROGRESS' } });

    const res = await cancel(nusrat, ride.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RIDE_ALREADY_STARTED');
    expect((await prisma.rideRequest.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe('IN_PROGRESS');
  });

  it('[I-AUTHZ-01] Rafiq cannot cancel Nusrat\'s ride, and her ride is unchanged', async () => {
    const ride = (await requestRide(nusrat)).body.ride;

    const res = await cancel(rafiq, ride.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const stored = await prisma.rideRequest.findUniqueOrThrow({ where: { id: ride.id } });
    expect(stored.status).toBe('REQUESTED');
    expect(await prisma.rideEvent.count({ where: { type: 'REQUEST_CANCELLED' } })).toBe(0);
  });

  it('[I-AUTH-04] a driver cannot use passenger cancel, and a foreign site cannot either', async () => {
    const ride = (await requestRide(nusrat)).body.ride;

    const asDriver = await cancel(jashim, ride.id);
    const foreign = await nusrat.post(`/api/v1/rides/${ride.id}/cancel`).set('Origin', 'https://evil.example');

    expect(asDriver.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect((await prisma.rideRequest.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe('REQUESTED');
  });
});
