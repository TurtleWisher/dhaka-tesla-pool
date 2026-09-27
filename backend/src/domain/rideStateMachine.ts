/**
 * Which status changes a ride request may make (docs/architecture.md §8.3). Pure: no database.
 * The service still performs each change as a conditional update ("... WHERE status = <from>"),
 * so two requests racing to change the same ride cannot both succeed (D-08).
 * The pool's own lifecycle is added with the driver flow.
 */

export const REQUEST_STATUSES = ['REQUESTED', 'MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** For each status, the statuses it may move to next. Anything not listed is refused. */
const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  REQUESTED: ['MATCHED', 'CANCELLED'], // joins a pool, or the passenger cancels
  MATCHED: ['REQUESTED', 'IN_PROGRESS', 'CANCELLED'], // driver cancelled the pool, trip starts, or passenger cancels
  IN_PROGRESS: ['COMPLETED'], // trip ends
  COMPLETED: [], // final
  CANCELLED: [], // final
};

/** True when a ride request may move from `from` to `to`. */
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** Statuses from which a ride can never move again. */
export function isFinal(status: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[status].length === 0;
}

/**
 * Statuses in which a request still "counts": a passenger may have at most one ride in these
 * (A-12). Must match the partial unique index `ride_requests_one_active_per_passenger`.
 */
export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = REQUEST_STATUSES.filter(
  (status) => !isFinal(status),
);
