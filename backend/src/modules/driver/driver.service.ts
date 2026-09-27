import { ACTIVE_POOL_STATUSES } from '../../domain/rideStateMachine.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';

/** The driver's side of the app. Every query is scoped to the signed-in driver's own vehicle. */
export function createDriverService(prisma: PrismaClient) {
  return {
    /** Starts taking requests (A-15). Going online twice is harmless. */
    async goOnline(driverId: string): Promise<{ isOnline: boolean }> {
      await prisma.driverProfile.update({ where: { userId: driverId }, data: { isOnline: true } });
      return { isOnline: true };
    },

    /** Stops taking requests, but never while a pool is still under way (A-15). */
    async goOffline(driverId: string): Promise<{ isOnline: boolean }> {
      return prisma.$transaction(async (tx) => {
        // Writing the driver's row first also locks it, so an accept by this driver at the same
        // moment waits for us (lock order: driver, then pool, then requests).
        await tx.driverProfile.update({ where: { userId: driverId }, data: { isOnline: false } });
        const activePool = await tx.pool.findFirst({
          where: { vehicle: { driverId }, status: { in: [...ACTIVE_POOL_STATUSES] } },
          select: { id: true },
        });
        if (activePool) {
          // Throwing inside the transaction undoes the write above: the driver stays online.
          throw new AppError(409, 'ACTIVE_POOL_EXISTS', 'Finish or cancel your current pool before going offline', {
            poolId: activePool.id,
          });
        }
        return { isOnline: false };
      });
    },
  };
}

export type DriverService = ReturnType<typeof createDriverService>;
