import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '../../src/modules/auth/session.js';

const SECRET = 'unit-test-secret-that-is-long-enough-0123';
const nusrat = { id: '4f1c2a9e-6b1d-4c3e-9a57-2d8e1f0b7c65', role: 'PASSENGER' } as const;

/** Builds a JWT by hand, for tokens our own code would never sign. */
function handMadeToken(header: object, payload: object, signature = ''): string {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode(header)}.${encode(payload)}.${signature}`;
}

describe('session tokens', () => {
  it('[U-AUTH-01] signs a token that verifies back to the same user', () => {
    const token = signSession(nusrat, SECRET);

    expect(verifySession(token, SECRET)).toEqual(nusrat);
  });

  it('[U-AUTH-01] puts only the user id, role and times in the token', () => {
    const payload = jwt.decode(signSession(nusrat, SECRET)) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(SESSION_TTL_SECONDS); // 8 hours
  });

  it('[U-AUTH-01] refuses a token signed with a different secret', () => {
    const token = signSession(nusrat, 'another-secret-that-is-also-long-enough-99');

    expect(() => verifySession(token, SECRET)).toThrow('Please sign in');
  });

  it('[U-AUTH-01] refuses a token whose content was changed after signing', () => {
    const [header, , signature] = signSession(nusrat, SECRET).split('.');
    // Nusrat tries to promote herself to driver but cannot re-sign the token.
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: nusrat.id, role: 'DRIVER', iat: 1, exp: 9999999999 }),
    ).toString('base64url');

    expect(() => verifySession(`${header}.${forgedPayload}.${signature}`, SECRET)).toThrow(
      'Please sign in',
    );
  });

  it('[U-AUTH-01] refuses an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign({ role: 'PASSENGER', iat: now - 9 * 3600, exp: now - 3600 }, SECRET, {
      algorithm: 'HS256',
      subject: nusrat.id,
    });

    expect(() => verifySession(expired, SECRET)).toThrow('Please sign in');
  });

  it('[U-AUTH-01] refuses an unsigned token ("alg": "none")', () => {
    const unsigned = handMadeToken({ alg: 'none', typ: 'JWT' }, { sub: nusrat.id, role: 'DRIVER' });

    expect(() => verifySession(unsigned, SECRET)).toThrow('Please sign in');
  });

  it('[U-AUTH-01] refuses a correctly signed token with unexpected content', () => {
    const badRole = jwt.sign({ role: 'ADMIN' }, SECRET, { algorithm: 'HS256', subject: nusrat.id });
    const badSubject = jwt.sign({ role: 'PASSENGER' }, SECRET, { algorithm: 'HS256', subject: 'nusrat' });

    expect(() => verifySession(badRole, SECRET)).toThrow('Please sign in');
    expect(() => verifySession(badSubject, SECRET)).toThrow('Please sign in');
    expect(() => verifySession('not-a-jwt', SECRET)).toThrow('Please sign in');
  });

  it('[U-AUTH-01] every refusal is the same 401 UNAUTHENTICATED error', () => {
    try {
      verifySession('not-a-jwt', SECRET);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: 'Please sign in' });
    }
  });
});

describe('session cookie options', () => {
  it('[U-AUTH-01] is httpOnly and SameSite=Lax, and Secure only in production', () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
