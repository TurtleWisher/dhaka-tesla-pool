import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CAST, seedCast } from '../../src/db/seedCast.js';
import { createTestPrisma, expectUniqueViolation, resetDatabase } from '../helpers/db.js';

/**
 * These tests go around the application on purpose and write straight to the database.
 * They prove that PostgreSQL itself refuses impossible data, so even a bug in our code
 * could not, for example, overbook Bullet.
 */
const prisma = createTestPrisma();

let vehicleId: string;
let nusratId: string;

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedCast(prisma);
  const bullet = await prisma.vehicle.findFirstOrThrow({ where: { name: 'Bullet' } });
  const nusrat = await prisma.user.findUniqueOrThrow({ where: { email: 'nusrat@teslapool.test' } });
  vehicleId = bullet.id;
  nusratId = nusrat.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A valid ride request for Nusrat (Banani to Mohakhali, 3 km, solo estimate ৳125). */
function nusratRequest(overrides: Record<string, unknown> = {}) {
  return {
    passengerId: nusratId,
    pickupZone: 'BANANI',
    dropoffZone: 'MOHAKHALI',
    seats: 1,
    distanceM: 3000,
    estimatedFarePoysha: 12500,
    ...overrides,
  } as const;
}

describe('pool seat counter (the overbooking backstop)', () => {
  it('[I-DB-01] refuses seats_available below 0', async () => {
    const pool = await prisma.pool.create({
      data: { vehicleId, pickupZone: 'BANANI', capacity: 3, seatsAvailable: 0 },
    });

    await expect(
      prisma.pool.update({ where: { id: pool.id }, data: { seatsAvailable: { decrement: 1 } } }),
    ).rejects.toThrow(/pools_seats_available_range/);
  });

  it('[I-DB-01] refuses seats_available above the capacity', async () => {
    await expect(
      prisma.pool.create({
        data: { vehicleId, pickupZone: 'BANANI', capacity: 3, seatsAvailable: 4 },
      }),
    ).rejects.toThrow(/pools_seats_available_range/);
  });

  it('[I-DB-02] allows only one unfinished pool per vehicle', async () => {
    await prisma.pool.create({ data: { vehicleId, pickupZone: 'BANANI', capacity: 3, seatsAvailable: 3 } });

    await expectUniqueViolation(
      prisma.pool.create({ data: { vehicleId, pickupZone: 'GULSHAN_1', capacity: 3, seatsAvailable: 3 } }),
      'pools_one_active_per_vehicle',
    );

    // Once the first pool is finished, Bullet can start a new one.
    await prisma.pool.updateMany({ where: { vehicleId }, data: { status: 'COMPLETED' } });
    await expect(
      prisma.pool.create({ data: { vehicleId, pickupZone: 'GULSHAN_1', capacity: 3, seatsAvailable: 3 } }),
    ).resolves.toBeDefined();
  });
});

describe('ride request rules', () => {
  it('[I-DB-03] refuses a ride whose pickup and drop-off are the same zone', async () => {
    await expect(
      prisma.rideRequest.create({ data: nusratRequest({ dropoffZone: 'BANANI' }) }),
    ).rejects.toThrow(/ride_requests_pickup_differs_from_dropoff/);
  });

  it('[I-DB-03] refuses 0 seats and more than 3 seats', async () => {
    await expect(prisma.rideRequest.create({ data: nusratRequest({ seats: 0 }) })).rejects.toThrow(
      /ride_requests_seats_range/,
    );
    await expect(prisma.rideRequest.create({ data: nusratRequest({ seats: 4 }) })).rejects.toThrow(
      /ride_requests_seats_range/,
    );
  });

  it('[I-DB-04] allows only one active request per passenger', async () => {
    const first = await prisma.rideRequest.create({ data: nusratRequest() });

    // A double-click would try to create a second active request: refused.
    await expectUniqueViolation(
      prisma.rideRequest.create({ data: nusratRequest() }),
      'ride_requests_one_active_per_passenger',
    );

    // After the first one is cancelled, Nusrat can request again.
    await prisma.rideRequest.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await expect(prisma.rideRequest.create({ data: nusratRequest() })).resolves.toBeDefined();
  });

  it('[I-DB-05] refuses a fare breakdown that does not add up', async () => {
    const ride = await prisma.rideRequest.create({ data: nusratRequest() });

    // Nusrat pooled: 5000 base + 7500 distance - 2500 discount = 10000 (৳100). 9999 is wrong.
    await expect(
      prisma.rideRequest.update({
        where: { id: ride.id },
        data: { fareBasePoysha: 5000, fareDistancePoysha: 7500, fareDiscountPoysha: 2500, fareTotalPoysha: 9999 },
      }),
    ).rejects.toThrow(/ride_requests_fare_adds_up/);

    await expect(
      prisma.rideRequest.update({
        where: { id: ride.id },
        data: { fareBasePoysha: 5000, fareDistancePoysha: 7500, fareDiscountPoysha: 2500, fareTotalPoysha: 10000 },
      }),
    ).resolves.toMatchObject({ fareTotalPoysha: 10000 });
  });

  it('[I-DB-05] refuses a half-written fare', async () => {
    const ride = await prisma.rideRequest.create({ data: nusratRequest() });

    await expect(
      prisma.rideRequest.update({ where: { id: ride.id }, data: { fareTotalPoysha: 10000 } }),
    ).rejects.toThrow(/ride_requests_fare_all_or_nothing/);
  });
});

describe('pool membership and history', () => {
  it('[I-DB-06] lets a request be ACTIVE in only one pool at a time', async () => {
    const ride = await prisma.rideRequest.create({ data: nusratRequest() });
    const poolA = await prisma.pool.create({
      data: { vehicleId, pickupZone: 'BANANI', capacity: 3, seatsAvailable: 2 },
    });
    await prisma.poolMember.create({ data: { poolId: poolA.id, rideRequestId: ride.id } });

    // Pool A is cancelled, so Bullet may start pool B. But Nusrat's membership in A is still
    // ACTIVE, so she must not become ACTIVE in pool B as well.
    await prisma.pool.update({ where: { id: poolA.id }, data: { status: 'CANCELLED' } });
    const poolB = await prisma.pool.create({
      data: { vehicleId, pickupZone: 'BANANI', capacity: 3, seatsAvailable: 2 },
    });
    await expectUniqueViolation(
      prisma.poolMember.create({ data: { poolId: poolB.id, rideRequestId: ride.id } }),
      'pool_members_one_active_per_request',
    );

    // Once the first membership is closed (driver cancelled: REMOVED), joining pool B works.
    await prisma.poolMember.updateMany({ where: { poolId: poolA.id }, data: { status: 'REMOVED' } });
    await expect(
      prisma.poolMember.create({ data: { poolId: poolB.id, rideRequestId: ride.id } }),
    ).resolves.toBeDefined();
  });

  it('[I-DB-07] refuses a history event that is about nothing', async () => {
    await expect(prisma.rideEvent.create({ data: { type: 'POOL_CREATED' } })).rejects.toThrow(
      /ride_events_has_subject/,
    );
  });

  it('[I-DB-08] stores emails in lowercase only', async () => {
    await expect(
      prisma.user.create({
        data: { name: 'Nusrat', email: 'Nusrat@TeslaPool.test', passwordHash: 'x', role: 'PASSENGER' },
      }),
    ).rejects.toThrow(/users_email_lowercase/);
    expect(CAST.passengers.every((p) => p.email === p.email.toLowerCase())).toBe(true);
  });
});
