/**
 * An error we expect and can describe to the client, e.g. 404 NOT_FOUND or 409 POOL_FULL.
 * Anything that is NOT an AppError is treated as a bug and returned as a generic 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
