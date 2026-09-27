/**
 * The pooling rule (docs/architecture.md §9.2, A-02). Pure: no database.
 * It answers one question: may this waiting request join this pool?
 * The seat count used here may already be stale when it is read, so the final word on seats is
 * the atomic claim in the database (§11); this function decides compatibility.
 */
import type { PoolStatus } from './rideStateMachine.js';
import { type Zone, distanceKm } from './zones.js';

/** A new rider's drop-off must be at most this far from EVERY current rider's drop-off. */
export const MAX_DROPOFF_SPREAD_KM = 3;

/** What the rule needs to know about the waiting request. */
export interface JoiningRequest {
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
}

/** What the rule needs to know about the pool. */
export interface CandidatePool {
  status: PoolStatus;
  pickupZone: Zone;
  seatsAvailable: number;
  /** Drop-off zones of the passengers currently in the pool (ACTIVE members). */
  memberDropoffZones: readonly Zone[];
}

/** True when the request may join the pool. */
export function canJoin(request: JoiningRequest, pool: CandidatePool): boolean {
  return (
    pool.status === 'ACCEPTED' && // the roster is locked once the driver arrives (A-05)
    pool.pickupZone === request.pickupZone &&
    pool.seatsAvailable >= request.seats &&
    pool.memberDropoffZones.every(
      (dropoff) => distanceKm(dropoff, request.dropoffZone) <= MAX_DROPOFF_SPREAD_KM,
    )
  );
}
