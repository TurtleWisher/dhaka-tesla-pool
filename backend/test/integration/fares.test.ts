import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { createTestApp } from '../helpers/app.js';
import { type SignedInAgent, signIn } from '../helpers/auth.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);
let nusrat: SignedInAgent;
let jashim: SignedInAgent;

// These endpoints only read, so the cast is seeded once for the whole file.
beforeAll(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma, { bcryptCost: 4 });
  nusrat = await signIn(app, 'nusrat@teslapool.test');
  jashim = await signIn(app, 'jashim@teslapool.test');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/zones', () => {
  it('[I-ZONE-01] lists the 9 zones with their names, for any signed-in user', async () => {
    const res = await jashim.get('/api/v1/zones');

    expect(res.status).toBe(200);
    expect(res.body.zones).toHaveLength(9);
    expect(res.body.zones[0]).toEqual({ id: 'BANANI', name: 'Banani' });
    expect(res.body.zones).toContainEqual({ id: 'GULSHAN_1', name: 'Gulshan 1' });
  });

  it('[I-AUTH-05] needs a signed-in user', async () => {
    expect((await request(app).get('/api/v1/zones')).status).toBe(401);
  });
});

describe('GET /api/v1/fares/estimate', () => {
  it('[I-RIDE-03] shows Nusrat ৳125 solo and ৳100 pooled for Banani to Mohakhali', async () => {
    const res = await nusrat.get('/api/v1/fares/estimate?pickup=BANANI&dropoff=MOHAKHALI');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pickupZone: 'BANANI',
      dropoffZone: 'MOHAKHALI',
      seats: 1,
      distanceM: 3000,
      solo: { base: 5000, distance: 7500, discount: 0, total: 12500 },
      pooled: { base: 5000, distance: 7500, discount: 2500, total: 10000 },
    });
  });

  it('[I-RIDE-03] charges per seat: Rafiq with 2 seats to Gulshan 1 pays ৳240 pooled', async () => {
    const res = await nusrat.get('/api/v1/fares/estimate?pickup=BANANI&dropoff=GULSHAN_1&seats=2');

    expect(res.body.solo.total).toBe(30000);
    expect(res.body.pooled.total).toBe(24000);
  });

  it('[I-RIDE-01] explains an invalid trip with 400', async () => {
    const same = await nusrat.get('/api/v1/fares/estimate?pickup=BANANI&dropoff=BANANI');
    const unknown = await nusrat.get('/api/v1/fares/estimate?pickup=MOTIJHEEL&dropoff=BANANI');
    const tooMany = await nusrat.get('/api/v1/fares/estimate?pickup=BANANI&dropoff=UTTARA&seats=4');

    expect(same.status).toBe(400);
    expect(same.body.error.details).toEqual({ dropoff: ['Drop-off must be different from pickup'] });
    expect(unknown.body.error.details).toEqual({ pickup: ['Choose one of the 9 zones'] });
    expect(tooMany.body.error.details).toEqual({ seats: ['Choose 1 to 3 seats'] });
  });

  it('[I-AUTH-04] is for passengers: Jashim gets 403', async () => {
    const res = await jashim.get('/api/v1/fares/estimate?pickup=BANANI&dropoff=MOHAKHALI');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});
