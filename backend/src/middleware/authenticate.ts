import type { Request, RequestHandler } from 'express';
import type { UserRole } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, type SessionUser, verifySession } from '../modules/auth/session.js';

/**
 * Reads the session cookie, verifies it and attaches the user to the request.
 * No cookie, or an invalid or expired one: 401. The token is checked without a database
 * lookup, which is what "stateless session" means.
 */
export function authenticate(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    }
    req.user = verifySession(token, jwtSecret);
    next();
  };
}

/** The signed-in user. Only call this after `authenticate` has run. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  }
  return req.user;
}

/** Lets only the given roles through, e.g. `requireRole('DRIVER')`. Wrong role: 403. */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = currentUser(req);
    if (!allowed.includes(user.role)) {
      const who = allowed.map((role) => role.toLowerCase()).join(' or ');
      throw new AppError(403, 'FORBIDDEN_ROLE', `Only ${who} accounts can do this`);
    }
    next();
  };
}
