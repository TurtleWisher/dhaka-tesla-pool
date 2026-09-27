import { calculateFare } from '../../domain/fare.js';
import { ACTIVE_REQUEST_STATUSES } from '../../domain/rideStateMachine.js';
import { distanceMetres } from '../../domain/zones.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
import type { CreateRideInput } from './rides.schemas.js';
import { type RideView, rideSelect, toRideView } from './rides.view.js';

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
  };
}

export type RidesService = ReturnType<typeof createRidesService>;
