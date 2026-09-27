import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { ORIGIN, createTestApp } from '../helpers/app.js';
import { type SignedInAgent, signIn } from '../helpers/auth.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';
import { createBulletPool, createWaitingRequest } from '../helpers/pools.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);

let jashim: SignedInAgent;
let nusrat: SignedInAgent;

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma, { bcryptCost: 4 });
  [jashim, nusrat] = await Promise.all([
    signIn(app, 'jashim@teslapool.test'),
    signIn(app, 'nusrat@teslapool.test'),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const post = (agent: SignedInAgent, path: string) => agent.post(`/api/v1/driver${path}`).set('Origin', ORIGIN);

const isJashimOnline = async () =>
  (await prisma.driverProfile.findFirstOrThrow({ where: { user: { email: 'jashim@teslapool.test' } } })).isOnline;

describe('POST /api/v1/driver/online and /offline', () => {
  it('[I-DRV-01] Jashim starts offline, goes online, then offline again', async () => {
    expect(await isJashimOnline()).toBe(false); // the seed

    const online = await post(jashim, '/online');
    expect(online.status).toBe(200);
    expect(online.body).toEqual({ driver: { isOnline: true } });
    expect(await isJashimOnline()).toBe(true);

    const offline = await post(jashim, '/offline');
    expect(offline.body).toEqual({ driver: { isOnline: false } });
    expect(await isJashimOnline()).toBe(false);
  });

  it('[I-DRV-01] refuses to go offline while Bullet has a pool under way, and stays online', async () => {
    await post(jashim, '/online');
    const pool = await createBulletPool(prisma);

    const res = await post(jashim, '/offline');

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ACTIVE_POOL_EXISTS',
      message: 'Finish or cancel your current pool before going offline',
      details: { poolId: pool.id },
    });
    expect(await isJashimOnline()).toBe(true);
  });

  it('[I-AUTH-04] is for drivers only, signed in, from the app', async () => {
    const asPassenger = await post(nusrat, '/online');
    const anonymous = await request(app).post('/api/v1/driver/online').set('Origin', ORIGIN);
    const foreign = await jashim.post('/api/v1/driver/online').set('Origin', 'https://evil.example');

    expect(asPassenger.status).toBe(403);
    expect(asPassenger.body.error.code).toBe('FORBIDDEN_ROLE');
    expect(anonymous.status).toBe(401);
    expect(foreign.status).toBe(403);
    expect(await isJashimOnline()).toBe(false);
  });
});

describe('GET /api/v1/driver/requests', () => {
  const listed = async () => {
    const res = await jashim.get('/api/v1/driver/requests');
    expect(res.status).toBe(200);
    return res.body.requests as { id: string; passengerName: string }[];
  };

  it('[I-DRV-02] shows nothing while Jashim is offline', async () => {
    await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });

    expect(await listed()).toEqual([]);
  });

  it('[I-DRV-02] with no pool under way, shows every waiting ride, oldest first, with what he needs to decide', async () => {
    await post(jashim, '/online');
    const nusrats = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });
    const rafiqs = await createWaitingRequest(prisma, 'rafiq@teslapool.test', {
      pickupZone: 'MOHAKHALI',
      dropoffZone: 'GULSHAN_1',
    });

    const requests = await listed();

    expect(requests.map((r) => r.id)).toEqual([nusrats.id, rafiqs.id]);
    expect(requests[0]).toEqual({
      id: nusrats.id,
      passengerName: 'Nusrat',
      pickupZone: 'BANANI',
      dropoffZone: 'MOHAKHALI',
      seats: 1,
      distanceM: 3000,
      estimatedFarePoysha: 12500,
      createdAt: expect.any(String),
    });
  });

  it('[I-DRV-02] with an open pool, shows only rides that fit it: same pickup, free seats, close drop-offs', async () => {
    await post(jashim, '/online');
    const nusrats = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });
    await post(jashim, `/requests/${nusrats.id}/accept`); // pool with Nusrat, 2 seats left
    const rafiqs = await createWaitingRequest(prisma, 'rafiq@teslapool.test', { dropoffZone: 'GULSHAN_1' });
    await createWaitingRequest(prisma, 'shirin@teslapool.test', { dropoffZone: 'GULSHAN_2' }); // 4 km from Mohakhali

    expect((await listed()).map((r) => r.passengerName)).toEqual(['Rafiq']);

    // Three seats do not fit in the two that are left.
    await prisma.rideRequest.update({ where: { id: rafiqs.id }, data: { seats: 3 } });
    expect(await listed()).toEqual([]);
  });

  it('[I-DRV-02] shows nothing once the roster is locked (driver arrived)', async () => {
    await post(jashim, '/online');
    await createBulletPool(prisma, { status: 'DRIVER_ARRIVED' });
    await createWaitingRequest(prisma, 'rafiq@teslapool.test', { dropoffZone: 'GULSHAN_1' });

    expect(await listed()).toEqual([]);
  });

  it('[I-AUTH-04] is for drivers only', async () => {
    const res = await nusrat.get('/api/v1/driver/requests');

    expect(res.status).toBe(403);
  });
});
