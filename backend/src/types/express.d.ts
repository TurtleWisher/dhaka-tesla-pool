import type { SessionUser } from '../modules/auth/session.js';

// Teaches TypeScript that Express requests can carry the signed-in user.
declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware once the session cookie has been verified. */
      user?: SessionUser;
    }
  }
}

export {};
