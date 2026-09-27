import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from '../../src/lib/validation.js';
import { authenticate, currentUser, requireRole } from '../../src/middleware/authenticate.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { originCheck } from '../../src/middleware/originCheck.js';
import { signSession } from '../../src/modules/auth/session.js';

/**
 * A tiny app that uses the middleware exactly like the real routes will
 * (driver-only and passenger-only routes arrive in later phases).
 */
const SECRET = 'middleware-test-secret-long-enough-01234';
const ORIGIN = 'http://localhost:3000';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(originCheck(ORIGIN));
app.get('/whoami', authenticate(SECRET), (req, res) => {
  res.json(currentUser(req));
});
app.post('/driver-only', authenticate(SECRET), requireRole('DRIVER'), (_req, res) => {
  res.json({ ok: true });
});
app.post('/passenger-only', authenticate(SECRET), requireRole('PASSENGER'), (_req, res) => {
  res.json({ ok: true });
});
app.post('/echo', (req, res) => {
  res.json(parseBody(z.object({ name: z.string().min(1) }), req.body));
});
app.use(errorHandler);

const jashim = { id: '0b7e8c4d-3f2a-4a1b-9c6d-5e4f3a2b1c0d', role: 'DRIVER' } as const;
const nusrat = { id: '4f1c2a9e-6b1d-4c3e-9a57-2d8e1f0b7c65', role: 'PASSENGER' } as const;
const cookieFor = (user: typeof jashim | typeof nusrat) => `dtp_session=${signSession(user, SECRET)}`;

describe('authenticate', () => {
  it('[I-AUTH-05] attaches the signed-in user from a valid session cookie', async () => {
    const res = await request(app).get('/whoami').set('Cookie', cookieFor(nusrat));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(nusrat);
  });

  it('[I-AUTH-05] refuses a missing or invalid session cookie with 401', async () => {
    const missing = await request(app).get('/whoami');
    const garbage = await request(app).get('/whoami').set('Cookie', 'dtp_session=not-a-token');

    for (const res of [missing, garbage]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } });
    }
  });
});

describe('requireRole', () => {
  it('[I-AUTH-04] lets the right role through', async () => {
    const res = await request(app).post('/driver-only').set('Origin', ORIGIN).set('Cookie', cookieFor(jashim));

    expect(res.status).toBe(200);
  });

  it('[I-AUTH-04] refuses a passenger on a driver route, and a driver on a passenger route', async () => {
    const nusratAsDriver = await request(app)
      .post('/driver-only')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieFor(nusrat));
    const jashimAsPassenger = await request(app)
      .post('/passenger-only')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieFor(jashim));

    expect(nusratAsDriver.status).toBe(403);
    expect(nusratAsDriver.body.error).toEqual({ code: 'FORBIDDEN_ROLE', message: 'Only driver accounts can do this' });
    expect(jashimAsPassenger.status).toBe(403);
    expect(jashimAsPassenger.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('[I-AUTH-04] asks for sign-in (401) before checking the role', async () => {
    const res = await request(app).post('/driver-only').set('Origin', ORIGIN);

    expect(res.status).toBe(401);
  });
});

describe('origin check', () => {
  it('[I-AUTH-06] refuses a POST from another website or without an Origin header', async () => {
    const foreign = await request(app).post('/echo').set('Origin', 'https://evil.example').send({ name: 'x' });
    const missing = await request(app).post('/echo').send({ name: 'x' });

    for (const res of [foreign, missing]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BAD_ORIGIN');
    }
  });

  it('[I-AUTH-06] allows a POST from the app, and GET requests from anywhere', async () => {
    const fromApp = await request(app).post('/echo').set('Origin', ORIGIN).send({ name: 'Nusrat' });
    const getAnywhere = await request(app)
      .get('/whoami')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieFor(nusrat));

    expect(fromApp.status).toBe(200);
    expect(getAnywhere.status).toBe(200);
  });
});

describe('parseBody', () => {
  it('[I-AUTH-08] returns 400 with the problem for each field', async () => {
    const res = await request(app).post('/echo').set('Origin', ORIGIN).send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details)).toEqual(['name']);
  });

  it('[I-AUTH-08] drops fields the schema does not know', async () => {
    const res = await request(app).post('/echo').set('Origin', ORIGIN).send({ name: 'Nusrat', role: 'DRIVER' });

    expect(res.body).toEqual({ name: 'Nusrat' });
  });
});
