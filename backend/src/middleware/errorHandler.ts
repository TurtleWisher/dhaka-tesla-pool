import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/** Runs when no route matched: turn it into a normal 404 error. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

/** Errors thrown by express.json() (bad JSON, body too large) carry a status and a type. */
function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number' &&
    typeof (err as { type?: unknown }).type === 'string'
  );
}

/**
 * The single place where errors become HTTP responses.
 * Every error response has the same shape: { "error": { "code", "message", "details"? } }
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }

  if (isBodyParserError(err) && err.status < 500) {
    const tooLarge = err.type === 'entity.too.large';
    res.status(err.status).json({
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        message: tooLarge ? 'Request body is too large' : 'Request body is not valid JSON',
      },
    });
    return;
  }

  // Unexpected: log the details for us, but never leak a stack trace to the client.
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
