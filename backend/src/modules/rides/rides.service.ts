import { calculateFare } from '../../domain/fare.js';
import { ACTIVE_REQUEST_STATUSES, type RequestStatus } from '../../domain/rideStateMachine.js';
import { distanceMetres } from '../../domain/zones.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
import { type Tx, assignRequestToPool, releaseSeats } from '../pools/seatClaim.js';
import type { CreateRideInput, HistoryInput } from './rides.schemas.js';
import { type RideEventView, type RideView, rideEventSelect, rideSelect, toRideView } from './rides.view.js';

/** One page of history. `nextCursor` is null on the last page. */
export interface RideHistoryPage {
  rides: RideView[];
  nextCursor: string | null;
}

/** Missing and "not yours" look exactly the same, so ride ids reveal nothing. */
const rideNotFound = () => new AppError(404, 'NOT_FOUND', 'Ride not found');

/** Why a ride in this status cannot be cancelled (docs/architecture.md §8.4). */
function cancelRefused(status: RequestStatus): AppError {
  if (status === 'IN_PROGRESS') {
    return new AppError(409, 'RIDE_ALREADY_STARTED', 'Your trip has already started and cannot be cancelled');
  }
  if (status === 'REQUESTED' || status === 'MATCHED') {
    // Still cancellable, but it changed while we were working (e.g. the pool was cancelled).
    return new AppError(409, 'CONFLICT_RETRY', 'Your ride changed while we were cancelling it. Please try again');
  }
  return new AppError(409, 'INVALID_TRANSITION', `A ${status.toLowerCase()} ride cannot be cancelled`, {
    from: status,
    to: 'CANCELLED',
  });
}

/**
 * Takes a MATCHED ride out of its pool (§8.4, §11.6): seats back, member LEFT, request CANCELLED.
 * The pool is locked first, then the request (D-12). If the pool is left empty, it is cancelled
 * too, so the driver is free to accept again (I-CANCEL-04). Any refusal throws, which undoes
 * everything in the transaction.
 */
async function leavePool(tx: Tx, passengerId: string, rideId: string): Promise<void> {
  // Something changed underneath us: answer from the ride's status as it is now.
  const refusal = async () => {
    const now = await tx.rideRequest.findFirstOrThrow({ where: { id: rideId, passengerId }, select: { status: true } });
    return cancelRefused(now.status);
  };

  // 1. Which pool, and how many seats (a plain read; the guards below make it safe).
  const member = await tx.poolMember.findFirst({
    where: { rideRequestId: rideId, status: 'ACTIVE' },
    select: { id: true, poolId: true, rideRequest: { select: { seats: true } } },
  });
  if (!member) {
    throw await refusal();
  }

  // 2. The pool first: give the seats back, only if the trip has not started.
  if (!(await releaseSeats(tx, member.poolId, member.rideRequest.seats))) {
    throw await refusal();
  }

  // 3. Then the request: only if it is still MATCHED.
  const now = new Date();
  const cancelled = await tx.rideRequest.updateMany({
    where: { id: rideId, passengerId, status: 'MATCHED' },
    data: { status: 'CANCELLED', cancelledAt: now },
  });
  if (cancelled.count === 0) {
    throw await refusal();
  }
  await tx.poolMember.update({ where: { id: member.id }, data: { status: 'LEFT', leftAt: now } });
  await tx.rideEvent.create({
    data: {
      poolId: member.poolId,
      rideRequestId: rideId,
      actorUserId: passengerId,
      type: 'REQUEST_CANCELLED',
      fromStatus: 'MATCHED',
      toStatus: 'CANCELLED',
    },
  });

  // 4. The last rider out cancels the pool (the system does it, so the actor is null).
  const ridersLeft = await tx.poolMember.count({ where: { poolId: member.poolId, status: 'ACTIVE' } });
  if (ridersLeft === 0) {
    // We still hold the pool's lock, so its status is still ACCEPTED or DRIVER_ARRIVED.
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: member.poolId }, select: { status: true } });
    await tx.pool.update({ where: { id: member.poolId }, data: { status: 'CANCELLED', cancelledAt: now } });
    await tx.rideEvent.create({
      data: {
        poolId: member.poolId,
        type: 'POOL_CANCELLED',
        fromStatus: pool.status,
        toStatus: 'CANCELLED',
        data: { reason: 'the last rider left' },
      },
    });
  }
}

/**
 * Ride requests, seen from the passenger. Every query is scoped to `passengerId`, so a passenger
 * can only ever read or change their own rides (D-06): someone else's ride simply "does not exist".
 */
export function createRidesService(prisma: PrismaClient) {
  /** The passenger's one active ride (A-12), or null. */
  const findActive = (passengerId: string) =>
    prisma.rideRequest.findFirst({
      where: { passengerId, status: { in: [...ACTIVE_REQUEST_STATUSES] } },
      select: rideSelect,
    });

  return {
    /**
     * Creates a ride with its distance and solo estimate and logs REQUEST_CREATED, then tries
     * to place it in an open pool straight away (A-03, the "system path"). All in one
     * transaction: the passenger gets back either a waiting (REQUESTED) or a MATCHED ride.
     */
    async create(passengerId: string, input: CreateRideInput): Promise<RideView> {
      const distanceM = distanceMetres(input.pickupZone, input.dropoffZone);
      const estimate = calculateFare({ distanceM, seats: input.seats, pooled: false });

      try {
        // One transaction: the ride, its history and any pool match are saved together, or not at all.
        const ride = await prisma.$transaction(async (tx) => {
          const created = await tx.rideRequest.create({
            data: {
              passengerId,
              pickupZone: input.pickupZone,
              dropoffZone: input.dropoffZone,
              seats: input.seats,
              distanceM,
              estimatedFarePoysha: estimate.total,
            },
            select: rideSelect,
          });
          await tx.rideEvent.create({
            data: {
              rideRequestId: created.id,
              actorUserId: passengerId,
              type: 'REQUEST_CREATED',
              toStatus: 'REQUESTED',
              data: { pickupZone: input.pickupZone, dropoffZone: input.dropoffZone, seats: input.seats },
            },
          });

          // Open pools with the same pickup and enough free seats, oldest first. The seat claim
          // decides for real (it checks seats and the drop-off rule while holding the pool's lock).
          const openPools = await tx.pool.findMany({
            where: { status: 'ACCEPTED', pickupZone: input.pickupZone, seatsAvailable: { gte: input.seats } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 10,
            select: { id: true },
          });
          for (const pool of openPools) {
            if ((await assignRequestToPool(tx, pool.id, created, null)) === 'MATCHED') {
              break;
            }
          }
          // Read it back: it may be MATCHED now.
          return tx.rideRequest.findUniqueOrThrow({ where: { id: created.id }, select: rideSelect });
        });
        return toRideView(ride);
      } catch (err) {
        // The database, not a "check first" query, decides: even two requests arriving at the
        // same moment (a double click) cannot both create an active ride.
        if (isUniqueViolation(err, 'ride_requests_one_active_per_passenger')) {
          const active = await findActive(passengerId);
          throw new AppError(409, 'ACTIVE_REQUEST_EXISTS', 'You already have an active ride request', {
            rideId: active?.id,
          });
        }
        throw err;
      }
    },

    /** The passenger's active ride, or null when they have none. */
    async getCurrent(passengerId: string): Promise<RideView | null> {
      const ride = await findActive(passengerId);
      return ride ? toRideView(ride) : null;
    },

    /**
     * The passenger's rides, newest first, one page at a time ("cursor paging").
     * The cursor is the id of the last ride already shown; the next page starts right after it.
     * Unlike "skip the first 20", this never repeats or skips a ride when a new one is added
     * between two page loads.
     */
    async list(passengerId: string, { limit, cursor }: HistoryInput): Promise<RideHistoryPage> {
      if (cursor) {
        // The cursor must be one of this passenger's own rides.
        const own = await prisma.rideRequest.findFirst({
          where: { id: cursor, passengerId },
          select: { id: true },
        });
        if (!own) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
            cursor: ['cursor must be a nextCursor value from a previous page'],
          });
        }
      }

      const rows = await prisma.rideRequest.findMany({
        where: { passengerId },
        // createdAt orders the rides; id breaks ties, so the order is always the same.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // Ask for one extra row: if it exists, there is another page.
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }), // start after the cursor ride
        select: rideSelect,
      });

      const page = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      return {
        rides: page.map(toRideView),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    },

    /** One of the passenger's rides with its history. Someone else's ride is a 404. */
    async get(passengerId: string, rideId: string): Promise<RideView & { events: RideEventView[] }> {
      const ride = await prisma.rideRequest.findFirst({
        where: { id: rideId, passengerId }, // the ownership check IS the query
        select: {
          ...rideSelect,
          events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: rideEventSelect },
        },
      });
      if (!ride) {
        throw rideNotFound();
      }
      const { events, ...row } = ride;
      return { ...toRideView(row), events };
    },

    /**
     * Cancels the passenger's ride and logs REQUEST_CANCELLED (§8.4).
     * A waiting ride: one conditional update, "cancel it only if it is still REQUESTED right now",
     * so two cancel clicks racing each other cannot both succeed; the loser changes 0 rows.
     * A MATCHED ride also leaves its pool (seats back). A started or finished ride: 409.
     */
    async cancel(passengerId: string, rideId: string): Promise<RideView> {
      return prisma.$transaction(async (tx) => {
        const waiting = await tx.rideRequest.updateMany({
          where: { id: rideId, passengerId, status: 'REQUESTED' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        if (waiting.count === 1) {
          await tx.rideEvent.create({
            data: {
              rideRequestId: rideId,
              actorUserId: passengerId,
              type: 'REQUEST_CANCELLED',
              fromStatus: 'REQUESTED',
              toStatus: 'CANCELLED',
            },
          });
        } else {
          // It was not waiting: find out what it is, to cancel it or give the right answer.
          const ride = await tx.rideRequest.findFirst({
            where: { id: rideId, passengerId },
            select: { status: true },
          });
          if (!ride) {
            throw rideNotFound();
          }
          if (ride.status !== 'MATCHED') {
            throw cancelRefused(ride.status);
          }
          await leavePool(tx, passengerId, rideId);
        }

        const cancelled = await tx.rideRequest.findUniqueOrThrow({
          where: { id: rideId },
          select: rideSelect,
        });
        return toRideView(cancelled);
      });
    },
  };
}

export type RidesService = ReturnType<typeof createRidesService>;
