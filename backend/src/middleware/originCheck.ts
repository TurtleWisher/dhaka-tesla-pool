import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/** Methods that never change anything in this API, so they need no origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection: a request that changes something must come from our own web app.
 * Browsers always send the `Origin` header on POST requests and a web page cannot fake it,
 * so a form on another website that tries to post to our API is refused with 403.
 * (Together with the SameSite=Lax cookie this blocks cross-site request forgery.)
 */
export function originCheck(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get('origin') === allowedOrigin) {
      next();
      return;
    }
    throw new AppError(403, 'BAD_ORIGIN', 'This request must come from the Dhaka Tesla Pool app');
  };
}
