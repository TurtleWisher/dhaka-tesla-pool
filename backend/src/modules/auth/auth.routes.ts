import { type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { parseBody } from '../../lib/validation.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { LoginBody, RegisterBody } from './auth.schemas.js';
import type { AuthService, PublicUser } from './auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from './session.js';

/** Mounted at /api/v1/auth. */
export function createAuthRouter({ authService, config }: { authService: AuthService; config: AppConfig }): Router {
  const router = Router();
  const cookieOptions = sessionCookieOptions(config.NODE_ENV === 'production');

  /** Issues the session token and puts it in the httpOnly cookie. */
  const startSession = (res: Response, user: PublicUser) => {
    const token = signSession({ id: user.id, role: user.role }, config.JWT_SECRET);
    res.cookie(SESSION_COOKIE, token, cookieOptions);
  };

  // Slows down password guessing: at most AUTH_RATE_LIMIT_MAX login/register attempts
  // per IP address per 15 minutes, counted together. The counter lives in this process's memory.
  const attemptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8', // tells the client how many attempts are left
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again'));
    },
  });

  router.post('/register', attemptLimiter, async (req, res) => {
    const input = parseBody(RegisterBody, req.body);
    const user = await authService.register(input);
    startSession(res, user);
    res.status(201).json({ user });
  });

  router.post('/login', attemptLimiter, async (req, res) => {
    const input = parseBody(LoginBody, req.body);
    const user = await authService.login(input);
    startSession(res, user);
    res.json({ user });
  });

  // No sign-in needed: logging out with an expired session should still clear the cookie.
  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions); // Express ignores maxAge here and expires it
    res.status(204).end();
  });

  router.get('/me', authenticate(config.JWT_SECRET), async (req, res) => {
    const user = await authService.getMe(currentUser(req).id);
    res.json({ user });
  });

  return router;
}
