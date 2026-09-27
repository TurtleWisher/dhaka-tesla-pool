import type { PoolStatus } from '../../domain/rideStateMachine.js';
import type { Zone } from '../../domain/zones.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** The columns a driver sees about their pool. Used as a Prisma `select`. */
export const poolSelect = {
  id: true,
  status: true,
  pickupZone: true,
  capacity: true,
  seatsAvailable: true,
  createdAt: true,
  members: {
    where: { status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
    select: {
      rideRequest: { select: { id: true, seats: true, dropoffZone: true, passenger: { select: { name: true } } } },
    },
  },
} as const;

/** One rider as the driver sees them (A-18): who, how many seats, where to. Fares arrive with the fare engine. */
export interface RiderView {
  rideId: string;
  passengerName: string;
  seats: number;
  dropoffZone: Zone;
}

/** A pool as the API returns it to its driver. */
export interface PoolView {
  id: string;
  status: PoolStatus;
  pickupZone: Zone;
  capacity: number;
  seatsAvailable: number;
  createdAt: Date;
  riders: RiderView[];
}

type PoolRow = Prisma.PoolGetPayload<{ select: typeof poolSelect }>;

/** Turns a database row into the API shape: the member rows become a simple rider list. */
export function toPoolView(row: PoolRow): PoolView {
  const { members, ...pool } = row;
  return {
    ...pool,
    riders: members.map(({ rideRequest }) => ({
      rideId: rideRequest.id,
      passengerName: rideRequest.passenger.name,
      seats: rideRequest.seats,
      dropoffZone: rideRequest.dropoffZone,
    })),
  };
}

/** The columns a driver sees about a waiting request (A-18). Used as a Prisma `select`. */
export const waitingRideSelect = {
  id: true,
  pickupZone: true,
  dropoffZone: true,
  seats: true,
  distanceM: true,
  estimatedFarePoysha: true,
  createdAt: true,
  passenger: { select: { name: true } },
} as const;

/** A waiting request as a driver sees it: enough to decide, and to know whom to pick up. */
export interface WaitingRideView {
  id: string;
  passengerName: string;
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
  distanceM: number;
  estimatedFarePoysha: number;
  createdAt: Date;
}

type WaitingRideRow = Prisma.RideRequestGetPayload<{ select: typeof waitingRideSelect }>;

/** Turns a database row into the API shape: the passenger object becomes just their name. */
export function toWaitingRideView({ passenger, ...ride }: WaitingRideRow): WaitingRideView {
  return { ...ride, passengerName: passenger.name };
}
