import { expect } from 'vitest';
import { calculateFare } from '../../src/domain/fare.js';
import { distanceMetres, type Zone } from '../../src/domain/zones.js';
import type { PoolStatus } from '../../src/generated/prisma/enums.js';
import type { PrismaClient } from '../../src/lib/prisma.js';

/**
 * The seat counter must always agree with the riders (I-POOL-04):
 * seats_available = capacity − the seats of every ACTIVE member. Checked after every pool test.
 */
export async function expectSeatInvariant(prisma: PrismaClient): Promise<void> {
  const pools = await prisma.pool.findMany({
    select: {
      id: true,
      capacity: true,
      seatsAvailable: true,
      members: { where: { status: 'ACTIVE' }, select: { rideRequest: { select: { seats: true } } } },
    },
  });
  for (const pool of pools) {
    const taken = pool.members.reduce((sum, member) => sum + member.rideRequest.seats, 0);
    expect(pool.seatsAvailable, `seat counter of pool ${pool.id}`).toBe(pool.capacity - taken);
  }
}

/** Creates a pool on Bullet directly in the database (test setup only). */
export async function createBulletPool(
  prisma: PrismaClient,
  { pickupZone = 'BANANI', status = 'ACCEPTED' }: { pickupZone?: Zone; status?: PoolStatus } = {},
) {
  const bullet = await prisma.vehicle.findFirstOrThrow({ where: { name: 'Bullet' } });
  return prisma.pool.create({
    data: { vehicleId: bullet.id, pickupZone, status, capacity: bullet.capacity, seatsAvailable: bullet.capacity },
  });
}

/** Creates a waiting (REQUESTED) ride directly in the database (test setup only). */
export async function createWaitingRequest(
  prisma: PrismaClient,
  email: string,
  { pickupZone = 'BANANI', dropoffZone, seats = 1 }: { pickupZone?: Zone; dropoffZone: Zone; seats?: number },
) {
  const passenger = await prisma.user.findUniqueOrThrow({ where: { email } });
  const distanceM = distanceMetres(pickupZone, dropoffZone);
  return prisma.rideRequest.create({
    data: {
      passengerId: passenger.id,
      pickupZone,
      dropoffZone,
      seats,
      distanceM,
      estimatedFarePoysha: calculateFare({ distanceM, seats, pooled: false }).total,
    },
  });
}
