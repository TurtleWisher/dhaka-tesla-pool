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
