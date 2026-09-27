import { calculateFare } from '../../domain/fare.js';
import { ACTIVE_REQUEST_STATUSES, type RequestStatus } from '../../domain/rideStateMachine.js';
import { distanceMetres } from '../../domain/zones.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
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
  return new AppError(409, 'INVALID_TRANSITION', `A ${status.toLowerCase()} ride cannot be cancelled`, {
    from: status,
    to: 'CANCELLED',
  });
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
    /** Creates a REQUESTED ride with its distance and solo estimate, and logs REQUEST_CREATED. */
    async create(passengerId: string, input: CreateRideInput): Promise<RideView> {
      const distanceM = distanceMetres(input.pickupZone, input.dropoffZone);
      const estimate = calculateFare({ distanceM, seats: input.seats, pooled: false });

      try {
        // One transaction: the ride and its first history entry are saved together, or not at all.
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
          return created;
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
     * Cancels a waiting ride (REQUESTED → CANCELLED) and logs REQUEST_CANCELLED.
     * The change is one conditional update: "cancel it only if it is still REQUESTED right now".
     * Two cancel clicks racing each other cannot both succeed; the loser changes 0 rows.
     * (A MATCHED ride can be cancelled too, but that also frees its seat in the pool, which
     * arrives together with pooling.)
     */
    async cancel(passengerId: string, rideId: string): Promise<RideView> {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.rideRequest.updateMany({
          where: { id: rideId, passengerId, status: 'REQUESTED' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        if (count === 0) {
          // Nothing changed: find out why, to give the right answer.
          const ride = await tx.rideRequest.findFirst({
            where: { id: rideId, passengerId },
            select: { status: true },
          });
          throw ride ? cancelRefused(ride.status) : rideNotFound();
        }

        await tx.rideEvent.create({
          data: {
            rideRequestId: rideId,
            actorUserId: passengerId,
            type: 'REQUEST_CANCELLED',
            fromStatus: 'REQUESTED',
            toStatus: 'CANCELLED',
          },
        });
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
