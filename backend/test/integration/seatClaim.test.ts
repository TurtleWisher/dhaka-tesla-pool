import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedCast } from '../../src/db/seedCast.js';
import { assignRequestToPool } from '../../src/modules/pools/seatClaim.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';
import { createBulletPool, createWaitingRequest, expectSeatInvariant } from '../helpers/pools.js';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma, { bcryptCost: 4 });
});

// [I-POOL-04] after every scenario, the seat counter still agrees with the riders.
afterEach(async () => {
  await expectSeatInvariant(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Runs one claim in its own transaction, as the services do. */
const claim = (poolId: string, request: Parameters<typeof assignRequestToPool>[2]) =>
  prisma.$transaction((tx) => assignRequestToPool(tx, poolId, request, null));

describe('assignRequestToPool: the only code that takes seats', () => {
  it('[I-CLAIM-01] places a waiting request: seats taken, MATCHED, a member row and a history event', async () => {
    const pool = await createBulletPool(prisma);
    const nusrat = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });

    expect(await claim(pool.id, nusrat)).toBe('MATCHED');

    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).seatsAvailable).toBe(2);
    const ride = await prisma.rideRequest.findUniqueOrThrow({ where: { id: nusrat.id } });
    expect(ride.status).toBe('MATCHED');
    expect(ride.matchedAt).toBeInstanceOf(Date);
    expect(await prisma.poolMember.findMany({ where: { poolId: pool.id } })).toMatchObject([
      { rideRequestId: nusrat.id, status: 'ACTIVE' },
    ]);
    expect(await prisma.rideEvent.findMany({ where: { poolId: pool.id } })).toMatchObject([
      { rideRequestId: nusrat.id, type: 'REQUEST_MATCHED', fromStatus: 'REQUESTED', toStatus: 'MATCHED', actorUserId: null },
    ]);
  });

  it('[I-CLAIM-02] refuses when the seats are not free, or the pool no longer takes riders, and changes nothing', async () => {
    const pool = await createBulletPool(prisma);
    const rafiq = await createWaitingRequest(prisma, 'rafiq@teslapool.test', { dropoffZone: 'GULSHAN_1', seats: 2 });
    expect(await claim(pool.id, rafiq)).toBe('MATCHED'); // 1 seat left
    const shirin = await createWaitingRequest(prisma, 'shirin@teslapool.test', { dropoffZone: 'GULSHAN_1', seats: 2 });
    const nusrat = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });

    expect(await claim(pool.id, shirin)).toBe('NO_SEATS'); // needs 2, 1 is free

    await prisma.pool.update({ where: { id: pool.id }, data: { status: 'DRIVER_ARRIVED' } });
    expect(await claim(pool.id, nusrat)).toBe('NO_SEATS'); // 1 seat is free, but the roster is locked

    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).seatsAvailable).toBe(1);
    expect((await prisma.rideRequest.findUniqueOrThrow({ where: { id: shirin.id } })).status).toBe('REQUESTED');
    expect((await prisma.rideRequest.findUniqueOrThrow({ where: { id: nusrat.id } })).status).toBe('REQUESTED');
    expect(await prisma.rideEvent.count()).toBe(1); // only Rafiq's match
  });

  it('[I-CLAIM-03] gives the seats back when the drop-off is too far from a current rider', async () => {
    const pool = await createBulletPool(prisma);
    const nusrat = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });
    expect(await claim(pool.id, nusrat)).toBe('MATCHED');
    const shirin = await createWaitingRequest(prisma, 'shirin@teslapool.test', { dropoffZone: 'GULSHAN_2' });

    expect(await claim(pool.id, shirin)).toBe('INCOMPATIBLE'); // Mohakhali ↔ Gulshan 2 = 4 km

    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).seatsAvailable).toBe(2);
    expect((await prisma.rideRequest.findUniqueOrThrow({ where: { id: shirin.id } })).status).toBe('REQUESTED');
  });

  it('[I-CLAIM-03] refuses a request from another pickup zone', async () => {
    const pool = await createBulletPool(prisma);
    const rafiq = await createWaitingRequest(prisma, 'rafiq@teslapool.test', {
      pickupZone: 'MOHAKHALI',
      dropoffZone: 'GULSHAN_1',
    });

    expect(await claim(pool.id, rafiq)).toBe('INCOMPATIBLE');
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).seatsAvailable).toBe(3);
  });

  it('[I-CLAIM-04] gives the seats back when the request is no longer waiting', async () => {
    const pool = await createBulletPool(prisma);
    const nusrat = await createWaitingRequest(prisma, 'nusrat@teslapool.test', { dropoffZone: 'MOHAKHALI' });
    await prisma.rideRequest.update({ where: { id: nusrat.id }, data: { status: 'CANCELLED' } });

    expect(await claim(pool.id, nusrat)).toBe('REQUEST_TAKEN');

    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).seatsAvailable).toBe(3);
    expect(await prisma.poolMember.count()).toBe(0);
  });
});
