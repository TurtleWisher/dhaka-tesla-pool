import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { ORIGIN, createTestApp } from '../helpers/app.js';
import { type SignedInAgent, signIn } from '../helpers/auth.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';
import { createWaitingRequest, expectSeatInvariant } from '../helpers/pools.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);

let jashim: SignedInAgent;
let nusrat: SignedInAgent;
let rafiq: SignedInAgent;
let shirin: SignedInAgent;

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma, { bcryptCost: 4 });
  [jashim, nusrat, rafiq, shirin] = await Promise.all([
    signIn(app, 'jashim@teslapool.test'),
    signIn(app, 'nusrat@teslapool.test'),
    signIn(app, 'rafiq@teslapool.test'),
    signIn(app, 'shirin@teslapool.test'),
  ]);
});

// [I-POOL-04] after every scenario, the seat counter still agrees with the riders.
afterEach(async () => {
  await expectSeatInvariant(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A passenger requests a ride from Banani, through the API. */
const requestRide = (agent: SignedInAgent, dropoffZone: string, seats = 1) =>
  agent.post('/api/v1/rides').set('Origin', ORIGIN).send({ pickupZone: 'BANANI', dropoffZone, seats });

const goOnline = (agent: SignedInAgent) => agent.post('/api/v1/driver/online').set('Origin', ORIGIN);

const accept = (agent: SignedInAgent, rideId: string) =>
  agent.post(`/api/v1/driver/requests/${rideId}/accept`).set('Origin', ORIGIN);

const statusOf = async (rideId: string) =>
  (await prisma.rideRequest.findUniqueOrThrow({ where: { id: rideId } })).status;

describe('POST /api/v1/driver/requests/:id/accept', () => {
  it('[I-POOL-01] Jashim accepts Nusrat: a pool on Bullet with 2 seats left, and Nusrat is MATCHED', async () => {
    await goOnline(jashim);
    const ride = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;

    const res = await accept(jashim, ride.id);

    expect(res.status).toBe(200);
    expect(res.body.pool).toMatchObject({
      status: 'ACCEPTED',
      pickupZone: 'BANANI',
      capacity: 3,
      seatsAvailable: 2,
      riders: [{ rideId: ride.id, passengerName: 'Nusrat', seats: 1, dropoffZone: 'MOHAKHALI' }],
    });
    expect((await nusrat.get('/api/v1/rides/current')).body.ride).toMatchObject({ status: 'MATCHED' });
    const events = await prisma.rideEvent.findMany({ where: { poolId: res.body.pool.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['POOL_CREATED', 'REQUEST_MATCHED']);
    const jashimsId = (await prisma.user.findUniqueOrThrow({ where: { email: 'jashim@teslapool.test' } })).id;
    expect(events.every((e) => e.actorUserId === jashimsId)).toBe(true);
  });

  it('[I-POOL-05] sweep: accepting Nusrat pulls in Rafiq, who was already waiting; Gulshan 2 stays behind', async () => {
    const nusratsRide = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;
    const rafiqsRide = (await requestRide(rafiq, 'GULSHAN_1')).body.ride;
    const shirinsRide = (await requestRide(shirin, 'GULSHAN_2')).body.ride; // 4 km from Mohakhali
    await goOnline(jashim);

    const res = await accept(jashim, nusratsRide.id);

    expect(res.body.pool.seatsAvailable).toBe(1);
    expect(res.body.pool.riders.map((r: { passengerName: string }) => r.passengerName)).toEqual(['Nusrat', 'Rafiq']);
    expect(await statusOf(rafiqsRide.id)).toBe('MATCHED');
    expect(await statusOf(shirinsRide.id)).toBe('REQUESTED');
    const rafiqsMatch = await prisma.rideEvent.findFirstOrThrow({ where: { rideRequestId: rafiqsRide.id, type: 'REQUEST_MATCHED' } });
    expect(rafiqsMatch.actorUserId).toBeNull(); // the system placed him, not the driver
  });

  it('[I-POOL-02] sweep, oldest first: Rafiq with 2 seats fills Bullet, and Shirin keeps waiting', async () => {
    const nusratsRide = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;
    const rafiqsRide = (await requestRide(rafiq, 'GULSHAN_1', 2)).body.ride;
    const shirinsRide = (await requestRide(shirin, 'GULSHAN_1')).body.ride;
    await goOnline(jashim);

    const res = await accept(jashim, nusratsRide.id);

    expect(res.body.pool.seatsAvailable).toBe(0);
    expect(await statusOf(rafiqsRide.id)).toBe('MATCHED');
    expect(await statusOf(shirinsRide.id)).toBe('REQUESTED'); // "waiting for a Tesla"
  });

  it('[I-POOL-01] a waiting ride can join Jashim\'s open pool; one that does not fit is refused', async () => {
    await goOnline(jashim);
    const pool = (await accept(jashim, (await requestRide(nusrat, 'MOHAKHALI')).body.ride.id)).body.pool;
    // Created straight in the database, so only the driver's accept can place them.
    const rafiqs = await createWaitingRequest(prisma, 'rafiq@teslapool.test', { dropoffZone: 'GULSHAN_1' });
    const shirins = await createWaitingRequest(prisma, 'shirin@teslapool.test', { dropoffZone: 'GULSHAN_2' });

    const joined = await accept(jashim, rafiqs.id);
    const tooFar = await accept(jashim, shirins.id);

    expect(joined.status).toBe(200);
    expect(joined.body.pool).toMatchObject({ id: pool.id, seatsAvailable: 1 });
    expect(tooFar.status).toBe(409);
    expect(tooFar.body.error.code).toBe('REQUEST_INCOMPATIBLE');
    expect(await statusOf(shirins.id)).toBe('REQUESTED');
  });

  it('[I-DRV-01] an offline driver cannot accept, and nothing is created', async () => {
    const ride = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;

    const res = await accept(jashim, ride.id);

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'DRIVER_OFFLINE', message: 'Go online before accepting rides' });
    expect(await prisma.pool.count()).toBe(0);
    expect(await statusOf(ride.id)).toBe('REQUESTED');
  });

  it('[I-POOL-01] a double tap on "Accept" creates exactly one pool; the second tap gets 409', async () => {
    await goOnline(jashim);
    const ride = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;

    const [a, b] = await Promise.all([accept(jashim, ride.id), accept(jashim, ride.id)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)?.body.error.code).toBe('REQUEST_ALREADY_MATCHED');
    expect(await prisma.pool.count()).toBe(1);
    expect(await prisma.poolMember.count()).toBe(1);
  });

  it('[I-POOL-01] refuses rides that cannot be accepted, and ids that are not rides', async () => {
    await goOnline(jashim);
    const cancelled = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;
    await nusrat.post(`/api/v1/rides/${cancelled.id}/cancel`).set('Origin', ORIGIN);

    const res = await accept(jashim, cancelled.id);
    const unknown = await accept(jashim, '00000000-0000-4000-8000-000000000000');
    const malformed = await accept(jashim, '42');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    for (const r of [unknown, malformed]) {
      expect(r.status).toBe(404);
      expect(r.body.error).toEqual({ code: 'NOT_FOUND', message: 'Ride request not found' });
    }
    expect(await prisma.pool.count()).toBe(0); // the refused accept left no empty pool behind
  });

  it('[I-POOL-01] refuses to add riders once Jashim has arrived (the roster is locked)', async () => {
    await goOnline(jashim);
    const pool = (await accept(jashim, (await requestRide(nusrat, 'MOHAKHALI')).body.ride.id)).body.pool;
    await prisma.pool.update({ where: { id: pool.id }, data: { status: 'DRIVER_ARRIVED' } });
    const rafiqs = await createWaitingRequest(prisma, 'rafiq@teslapool.test', { dropoffZone: 'GULSHAN_1' });

    const res = await accept(jashim, rafiqs.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_POOL_EXISTS');
    expect(await statusOf(rafiqs.id)).toBe('REQUESTED');
  });

  it('[I-AUTH-04] passengers cannot accept rides', async () => {
    const ride = (await requestRide(nusrat, 'MOHAKHALI')).body.ride;

    const res = await accept(rafiq, ride.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});

describe('POST /api/v1/rides: new rides join an open pool straight away', () => {
  it('[I-POOL-01] the story: Jashim accepts Nusrat, Rafiq joins at once, Shirin takes the last seat', async () => {
    await goOnline(jashim);
    const pool = (await accept(jashim, (await requestRide(nusrat, 'MOHAKHALI')).body.ride.id)).body.pool;

    const rafiqs = await requestRide(rafiq, 'GULSHAN_1'); // 2 km from Mohakhali
    const shirins = await requestRide(shirin, 'GULSHAN_1'); // 2 km and 0 km

    expect(rafiqs.status).toBe(201);
    expect(rafiqs.body.ride).toMatchObject({ status: 'MATCHED', matchedAt: expect.any(String) });
    expect(shirins.body.ride.status).toBe('MATCHED');
    const bullet = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });
    expect(bullet.seatsAvailable).toBe(0); // Bullet 3/3
    const rafiqsEvents = await prisma.rideEvent.findMany({ where: { rideRequestId: rafiqs.body.ride.id }, orderBy: { id: 'asc' } });
    expect(rafiqsEvents).toMatchObject([
      { type: 'REQUEST_CREATED', poolId: null },
      { type: 'REQUEST_MATCHED', poolId: pool.id, actorUserId: null },
    ]);
  });

  it('[I-POOL-03] Shirin to Gulshan 2 does not join a pool with Nusrat (4 km apart), and waits', async () => {
    await goOnline(jashim);
    await accept(jashim, (await requestRide(nusrat, 'MOHAKHALI')).body.ride.id);

    const res = await requestRide(shirin, 'GULSHAN_2');

    expect(res.status).toBe(201);
    expect(res.body.ride.status).toBe('REQUESTED');
    expect(res.body.ride.matchedAt).toBeNull();
  });

  it('[I-POOL-02] with Rafiq holding 2 seats, Nusrat takes the last seat and Shirin waits', async () => {
    await goOnline(jashim);
    await accept(jashim, (await requestRide(rafiq, 'GULSHAN_1', 2)).body.ride.id); // 1 seat left

    const nusrats = await requestRide(nusrat, 'MOHAKHALI');
    const shirins = await requestRide(shirin, 'GULSHAN_1');

    expect(nusrats.body.ride.status).toBe('MATCHED');
    expect(shirins.body.ride.status).toBe('REQUESTED');
  });

  it('[I-POOL-03] a ride from another pickup zone does not join', async () => {
    await goOnline(jashim);
    await accept(jashim, (await requestRide(nusrat, 'MOHAKHALI')).body.ride.id);

    const res = await rafiq
      .post('/api/v1/rides')
      .set('Origin', ORIGIN)
      .send({ pickupZone: 'MOHAKHALI', dropoffZone: 'GULSHAN_1' });

    expect(res.body.ride.status).toBe('REQUESTED');
  });
});
