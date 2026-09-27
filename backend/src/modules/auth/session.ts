import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { z } from 'zod';
import { UserRole } from '../../generated/prisma/enums.js';
import { AppError } from '../../lib/errors.js';

/** Name of the httpOnly cookie that carries the session token. */
export const SESSION_COOKIE = 'dtp_session';

/** A session lasts 8 hours; then the user signs in again (no refresh tokens in the MVP). */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Who is signed in. This is all the token contains: no name, email or password. */
export interface SessionUser {
  id: string;
  role: UserRole;
}

/** What a verified token must contain; anything else is treated as an invalid session. */
const SessionClaims = z.object({
  sub: z.uuid(),
  role: z.enum(UserRole),
});

/** Creates a signed session token (JWT, HS256) for this user. */
export function signSession(user: SessionUser, secret: string): string {
  return jwt.sign({ role: user.role }, secret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/**
 * Checks the signature and expiry, then returns the user.
 * Every failure (tampered, expired, wrong secret, unexpected content) becomes the same 401,
 * so a client learns nothing about why its token was refused.
 */
export function verifySession(token: string, secret: string): SessionUser {
  try {
    // Only HS256 is accepted, so a token claiming "alg": "none" (no signature) is refused.
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const claims = SessionClaims.parse(payload);
    return { id: claims.sub, role: claims.role };
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  }
}

/**
 * Cookie settings for the session.
 * httpOnly: page scripts cannot read it. SameSite=Lax: other websites cannot make the browser
 * send it with their form posts. Secure (production): only ever sent over HTTPS.
 */
export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000, // Express expects milliseconds
  };
}
