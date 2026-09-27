import { canJoin } from '../../domain/matching.js';
import { ACTIVE_POOL_STATUSES, type RequestStatus } from '../../domain/rideStateMachine.js';
import type { Zone } from '../../domain/zones.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
import { type ClaimResult, type Tx, assignRequestToPool, waitingRequestSelect } from '../pools/seatClaim.js';
import {
  type PoolView,
  type WaitingRideView,
  poolSelect,
  toPoolView,
  toWaitingRideView,
  waitingRideSelect,
} from './driver.view.js';

const requestNotFound = () => new AppError(404, 'NOT_FOUND', 'Ride request not found');

/** Why a request that is not waiting cannot be accepted. */
function notWaiting(status: RequestStatus): AppError {
  if (status === 'CANCELLED') {
    return new AppError(409, 'INVALID_TRANSITION', 'A cancelled ride cannot be accepted', {
      from: status,
      to: 'MATCHED',
    });
  }
  return new AppError(409, 'REQUEST_ALREADY_MATCHED', 'This ride is already in a pool');
}

/** Why the seat claim refused, in words for the driver. */
function acceptRefused(result: Exclude<ClaimResult, 'MATCHED'>): AppError {
  switch (result) {
    case 'NO_SEATS':
      return new AppError(409, 'SEATS_UNAVAILABLE', 'Your pool does not have enough free seats for this ride');
    case 'INCOMPATIBLE':
      return new AppError(409, 'REQUEST_INCOMPATIBLE', 'This ride does not fit your pool: different pickup or drop-off too far');
    case 'REQUEST_TAKEN':
      return new AppError(409, 'REQUEST_ALREADY_MATCHED', 'This ride is already in a pool');
  }
}

/** Reads a pool in the API shape (inside the same transaction, so it shows our own changes). */
async function loadPool(tx: Tx, poolId: string): Promise<PoolView> {
  return toPoolView(await tx.pool.findUniqueOrThrow({ where: { id: poolId }, select: poolSelect }));
}

/**
 * Right after a pool is created, pulls in other waiting requests that fit, oldest first,
 * until the pool is full (A-03 "sweep"). The system does this, so the actor is null.
 */
async function sweep(tx: Tx, poolId: string, pickupZone: Zone, seatsLeft: number): Promise<void> {
  const waiting = await tx.rideRequest.findMany({
    where: { status: 'REQUESTED', pickupZone },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 50,
    select: waitingRequestSelect,
  });
  for (const candidate of waiting) {
    if (seatsLeft === 0) {
      break;
    }
    if (candidate.seats <= seatsLeft && (await assignRequestToPool(tx, poolId, candidate, null)) === 'MATCHED') {
      seatsLeft -= candidate.seats;
    }
  }
}

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

    /**
     * The waiting requests this driver could take right now (A-16), oldest first:
     * offline → none; no pool under way → every waiting request; an open (ACCEPTED) pool → only
     * those that pass the pooling rule for it; a pool whose roster is locked → none.
     */
    async listRequests(driverId: string): Promise<WaitingRideView[]> {
      const driver = await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: driverId },
        select: { isOnline: true, vehicle: { select: { id: true } } },
      });
      if (!driver.isOnline || !driver.vehicle) {
        return [];
      }
      const pool = await prisma.pool.findFirst({
        where: { vehicleId: driver.vehicle.id, status: { in: [...ACTIVE_POOL_STATUSES] } },
        select: {
          status: true,
          pickupZone: true,
          seatsAvailable: true,
          members: { where: { status: 'ACTIVE' }, select: { rideRequest: { select: { dropoffZone: true } } } },
        },
      });
      if (pool && pool.status !== 'ACCEPTED') {
        return [];
      }

      const waiting = await prisma.rideRequest.findMany({
        // With an open pool, let the database narrow it down first: same pickup, seats that fit.
        where: { status: 'REQUESTED', ...(pool && { pickupZone: pool.pickupZone, seats: { lte: pool.seatsAvailable } }) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: waitingRideSelect,
      });
      const fitting = pool
        ? waiting.filter((ride) =>
            canJoin(ride, {
              status: pool.status,
              pickupZone: pool.pickupZone,
              seatsAvailable: pool.seatsAvailable,
              memberDropoffZones: pool.members.map((member) => member.rideRequest.dropoffZone),
            }),
          )
        : waiting;
      return fitting.map(toWaitingRideView);
    },

    /**
     * Accepts a waiting request (§9.3): with no pool under way, this creates one on the driver's
     * vehicle and then sweeps in other riders who fit; with an open pool, the request joins it.
     * Everything happens in one transaction: on any refusal, nothing is saved.
     */
    async accept(driverId: string, requestId: string): Promise<PoolView> {
      try {
        return await prisma.$transaction(async (tx) => {
          // 1. Only an online driver. The write locks the driver's row, so a double tap on
          //    "Accept" runs one accept after the other, never both at once.
          const online = await tx.driverProfile.updateMany({
            where: { userId: driverId, isOnline: true },
            data: { isOnline: true },
          });
          if (online.count === 0) {
            throw new AppError(409, 'DRIVER_OFFLINE', 'Go online before accepting rides');
          }

          // 2. The request must exist and still be waiting (the seat claim checks again, safely).
          const request = await tx.rideRequest.findUnique({
            where: { id: requestId },
            select: { ...waitingRequestSelect, status: true },
          });
          if (!request) {
            throw requestNotFound();
          }
          if (request.status !== 'REQUESTED') {
            throw notWaiting(request.status);
          }

          // 3. The vehicle's pool: the open one, or a new one.
          const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { driverId }, select: { id: true, capacity: true } });
          const current = await tx.pool.findFirst({
            where: { vehicleId: vehicle.id, status: { in: [...ACTIVE_POOL_STATUSES] } },
            select: { id: true, status: true },
          });
          if (current && current.status !== 'ACCEPTED') {
            throw new AppError(409, 'ACTIVE_POOL_EXISTS', 'Your pool is no longer taking riders', { poolId: current.id });
          }
          const poolId =
            current?.id ??
            (
              await tx.pool.create({
                data: {
                  vehicleId: vehicle.id,
                  pickupZone: request.pickupZone,
                  capacity: vehicle.capacity, // a snapshot: later changes to the vehicle do not affect this trip
                  seatsAvailable: vehicle.capacity,
                  events: { create: { actorUserId: driverId, type: 'POOL_CREATED', toStatus: 'ACCEPTED' } },
                },
                select: { id: true },
              })
            ).id;

          // 4. Place the accepted request: through the one seat claim, like every other join.
          const result = await assignRequestToPool(tx, poolId, request, driverId);
          if (result !== 'MATCHED') {
            throw acceptRefused(result);
          }

          // 5. A new pool pulls in the other waiting riders who fit.
          if (!current) {
            await sweep(tx, poolId, request.pickupZone, vehicle.capacity - request.seats);
          }
          return loadPool(tx, poolId);
        });
      } catch (err) {
        // Backstop: the database allows one pool under way per vehicle (A-14).
        if (isUniqueViolation(err, 'pools_one_active_per_vehicle')) {
          throw new AppError(409, 'ACTIVE_POOL_EXISTS', 'You already have a pool under way');
        }
        throw err;
      }
    },
  };
}

export type DriverService = ReturnType<typeof createDriverService>;
