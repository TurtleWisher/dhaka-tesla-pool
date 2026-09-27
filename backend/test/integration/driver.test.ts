import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { ORIGIN, createTestApp } from '../helpers/app.js';
import { type SignedInAgent, signIn } from '../helpers/auth.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';
import { createBulletPool } from '../helpers/pools.js';

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
