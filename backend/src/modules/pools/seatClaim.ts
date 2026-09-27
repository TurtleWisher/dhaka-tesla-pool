import { canJoin } from '../../domain/matching.js';
import type { Zone } from '../../domain/zones.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** The database handle inside `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;

/** The parts of a waiting ride request that placing it needs. */
export interface WaitingRequest {
  id: string;
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
}

/**
 * What happened when we tried to place a request:
 * - MATCHED: it is in the pool now.
 * - NO_SEATS: the pool is full, or no longer taking riders (not ACCEPTED).
 * - INCOMPATIBLE: a different pickup zone, or a drop-off too far from a current rider's.
 * - REQUEST_TAKEN: the request is no longer waiting (matched elsewhere, or cancelled).
 */
export type ClaimResult = 'MATCHED' | 'NO_SEATS' | 'INCOMPATIBLE' | 'REQUEST_TAKEN';

/**
 * Places a waiting request into a pool (docs/architecture.md §11.4). This is the ONLY code that
 * takes seats (A-03), and it must run inside a transaction. Whatever the result, a request that
 * was not MATCHED leaves the pool and the request exactly as they were.
 */
export async function assignRequestToPool(
  tx: Tx,
  poolId: string,
  request: WaitingRequest,
  actorUserId: string | null, // the driver who accepted, or null when the system matched it
): Promise<ClaimResult> {
  // 1. Claim the seats in one statement: "take n seats only if n are still free".
  //    This locks the pool row until the transaction ends, so any other join, cancel or start
  //    on this pool waits here. Lock order everywhere: the pool first, then requests (D-12).
  const seats = await tx.pool.updateMany({
    where: { id: poolId, status: 'ACCEPTED', seatsAvailable: { gte: request.seats } },
    data: { seatsAvailable: { decrement: request.seats } },
  });
  if (seats.count === 0) {
    return 'NO_SEATS';
  }
  const giveSeatsBack = () =>
    tx.pool.update({ where: { id: poolId }, data: { seatsAvailable: { increment: request.seats } } });

  // 2. While we hold the lock, nobody else can join this pool, so its rider list is final:
  //    check the pooling rule against it now, not against something read earlier.
  const pool = await tx.pool.findUniqueOrThrow({
    where: { id: poolId },
    select: {
      status: true,
      pickupZone: true,
      seatsAvailable: true,
      members: { where: { status: 'ACTIVE' }, select: { rideRequest: { select: { dropoffZone: true } } } },
    },
  });
  const fits = canJoin(request, {
    status: pool.status,
    pickupZone: pool.pickupZone,
    seatsAvailable: pool.seatsAvailable + request.seats, // as it was just before our claim
    memberDropoffZones: pool.members.map((member) => member.rideRequest.dropoffZone),
  });
  if (!fits) {
    await giveSeatsBack();
    return 'INCOMPATIBLE';
  }

  // 3. Claim the request: only if it is still waiting.
  const claimed = await tx.rideRequest.updateMany({
    where: { id: request.id, status: 'REQUESTED' },
    data: { status: 'MATCHED', matchedAt: new Date() },
  });
  if (claimed.count === 0) {
    await giveSeatsBack();
    return 'REQUEST_TAKEN';
  }

  // 4. Record who is in the pool, and the history.
  await tx.poolMember.create({ data: { poolId, rideRequestId: request.id } });
  await tx.rideEvent.create({
    data: {
      poolId,
      rideRequestId: request.id,
      actorUserId,
      type: 'REQUEST_MATCHED',
      fromStatus: 'REQUESTED',
      toStatus: 'MATCHED',
    },
  });
  return 'MATCHED';
}
