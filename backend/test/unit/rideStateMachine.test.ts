import { describe, expect, it } from 'vitest';
import {
  ACTIVE_POOL_STATUSES,
  ACTIVE_REQUEST_STATUSES,
  POOL_STATUSES,
  REQUEST_STATUSES,
  type RequestStatus,
  canTransition,
  isFinal,
} from '../../src/domain/rideStateMachine.js';
import {
  PoolStatus as DatabasePoolStatus,
  RequestStatus as DatabaseRequestStatus,
} from '../../src/generated/prisma/enums.js';

/** The allowed changes, written out independently from the code (docs/architecture.md §8.3). */
const ALLOWED: ReadonlyArray<[RequestStatus, RequestStatus]> = [
  ['REQUESTED', 'MATCHED'],
  ['REQUESTED', 'CANCELLED'],
  ['MATCHED', 'REQUESTED'],
  ['MATCHED', 'IN_PROGRESS'],
  ['MATCHED', 'CANCELLED'],
  ['IN_PROGRESS', 'COMPLETED'],
];

const isAllowed = (from: RequestStatus, to: RequestStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

describe('ride request state machine', () => {
  it('[U-SM-01] knows exactly the statuses the database knows', () => {
    expect([...REQUEST_STATUSES].sort()).toEqual(Object.values(DatabaseRequestStatus).sort());
  });

  it('[U-SM-01] accepts every allowed change', () => {
    for (const [from, to] of ALLOWED) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('[U-SM-02] refuses every other pair of statuses (all 25 combinations checked)', () => {
    let refused = 0;
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        if (isAllowed(from, to)) continue;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        refused += 1;
      }
    }
    expect(refused).toBe(25 - ALLOWED.length); // 19 refusals, including "stay the same"
  });

  it('[U-SM-02] never leaves COMPLETED or CANCELLED, and cannot skip ahead or go back from a trip', () => {
    expect(isFinal('COMPLETED')).toBe(true);
    expect(isFinal('CANCELLED')).toBe(true);
    expect(isFinal('REQUESTED')).toBe(false);
    expect(canTransition('REQUESTED', 'IN_PROGRESS')).toBe(false); // must be matched first
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false); // too late to cancel
    expect(canTransition('COMPLETED', 'REQUESTED')).toBe(false);
  });

  it('[U-SM-02] counts a ride as active until it is completed or cancelled', () => {
    // Same list as the database's "one active request per passenger" index (Phase 4).
    expect(ACTIVE_REQUEST_STATUSES).toEqual(['REQUESTED', 'MATCHED', 'IN_PROGRESS']);
  });

  it('[U-SM-01] knows exactly the pool statuses the database knows', () => {
    expect([...POOL_STATUSES].sort()).toEqual(Object.values(DatabasePoolStatus).sort());
  });

  it('[U-SM-02] counts a pool as occupying its vehicle until it is completed or cancelled', () => {
    // Same list as the database's "one active pool per vehicle" index (Phase 4).
    expect(ACTIVE_POOL_STATUSES).toEqual(['ACCEPTED', 'DRIVER_ARRIVED', 'STARTED']);
  });
});
