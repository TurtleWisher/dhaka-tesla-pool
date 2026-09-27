import type { FareBreakdown } from '../../domain/fare.js';
import type { RequestStatus } from '../../domain/rideStateMachine.js';
import type { Zone } from '../../domain/zones.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** The columns a passenger may see about their own ride. Used as a Prisma `select`. */
export const rideSelect = {
  id: true,
  status: true,
  pickupZone: true,
  dropoffZone: true,
  seats: true,
  distanceM: true,
  estimatedFarePoysha: true,
  fareBasePoysha: true,
  fareDistancePoysha: true,
  fareDiscountPoysha: true,
  fareTotalPoysha: true,
  createdAt: true,
  matchedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
} as const;

/** One ride request as the API returns it. Money is in poysha (৳1 = 100). */
export interface RideView {
  id: string;
  status: RequestStatus;
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
  distanceM: number;
  /** The solo price shown when the ride was requested. */
  estimatedFarePoysha: number;
  /** The final fare, locked when the trip starts; null until then. */
  fare: FareBreakdown | null;
  createdAt: Date;
  matchedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

/** One entry of a ride's history, e.g. REQUEST_CREATED at 08:41. */
export interface RideEventView {
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: Date;
}

/** Columns of each history entry shown to the passenger (no actor ids, no internal data). */
export const rideEventSelect = { type: true, fromStatus: true, toStatus: true, createdAt: true } as const;

/** The type Prisma returns for a ride read with `rideSelect` (generated from the schema). */
type RideRow = Prisma.RideRequestGetPayload<{ select: typeof rideSelect }>;

/** Turns a database row into the API shape: the four fare columns become one `fare` object. */
export function toRideView(row: RideRow): RideView {
  const { fareBasePoysha, fareDistancePoysha, fareDiscountPoysha, fareTotalPoysha, ...ride } = row;
  const fare =
    fareBasePoysha === null ||
    fareDistancePoysha === null ||
    fareDiscountPoysha === null ||
    fareTotalPoysha === null
      ? null
      : {
          base: fareBasePoysha,
          distance: fareDistancePoysha,
          discount: fareDiscountPoysha,
          total: fareTotalPoysha,
        };
  return { ...ride, fare };
}
