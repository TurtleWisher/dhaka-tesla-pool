import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, seedCast } from '../../src/db/seedCast.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { ORIGIN, createTestApp, testConfig } from '../helpers/app.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

/** The Set-Cookie header for the session cookie, or undefined if none was set. */
function sessionCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith('dtp_session='));
}

const nusratSignup = { name: 'Nusrat', email: 'nusrat@teslapool.test', password: 'Mohakhali#3km' };

describe('register', () => {
  beforeEach(async () => {
    await resetDatabase(prisma); // empty: Nusrat signs up for the first time
  });

  it('[I-AUTH-01] creates a passenger, signs her in and never returns the password hash', async () => {
    const nusrat = request.agent(app); // keeps cookies between requests, like a browser

    const res = await nusrat.post('/api/v1/auth/register').set('Origin', ORIGIN).send(nusratSignup);

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Nusrat',
      email: 'nusrat@teslapool.test',
      role: 'PASSENGER',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(sessionCookie(res)).toBeDefined();

    const me = await nusrat.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('nusrat@teslapool.test');
  });

  it('[I-AUTH-01] stores only a bcrypt hash of the password', async () => {
    await request(app).post('/api/v1/auth/register').set('Origin', ORIGIN).send(nusratSignup);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: nusratSignup.email } });
    expect(stored.passwordHash).not.toContain(nusratSignup.password);
    expect(stored.passwordHash).toMatch(/^\$2b\$04\$/); // the configured test cost
  });

  it('[I-AUTH-03] ignores a smuggled role: every sign-up is a passenger', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ ...nusratSignup, role: 'DRIVER' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PASSENGER');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: nusratSignup.email },
      include: { driverProfile: true },
    });
    expect(stored.role).toBe('PASSENGER');
    expect(stored.driverProfile).toBeNull();
  });

  it('[I-AUTH-08] stores the email trimmed and lowercase, so login is case-insensitive', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ ...nusratSignup, email: '  Nusrat@TeslaPool.TEST ' });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'NUSRAT@teslapool.test', password: nusratSignup.password });

    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('nusrat@teslapool.test');
  });

  it('[I-AUTH-08] refuses a second account for the same email with 409, whatever the capitals', async () => {
    await request(app).post('/api/v1/auth/register').set('Origin', ORIGIN).send(nusratSignup);

    const again = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ ...nusratSignup, email: 'NUSRAT@TESLAPOOL.TEST', password: 'another-password' });

    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({ code: 'EMAIL_TAKEN', message: 'This email is already registered' });
    expect(sessionCookie(again)).toBeUndefined();
    expect(await prisma.user.count()).toBe(1);
  });

  it('[I-AUTH-08] explains every invalid field with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ name: '  ', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual({
      name: ['Enter your name'],
      email: ['Enter a valid email address'],
      password: ['Password must be at least 8 characters'],
    });
  });

  it('[I-AUTH-08] refuses passwords longer than bcrypt can use (72 bytes)', async () => {
    // 37 characters, but "é" takes 2 bytes, so 74 bytes.
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ ...nusratSignup, password: 'é'.repeat(37) });

    expect(res.status).toBe(400);
    expect(res.body.error.details.password[0]).toMatch(/at most 72 bytes/);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedCast(prisma, { bcryptCost: 4 });
  });

  it('[I-AUTH-01] lets Jashim sign in as a driver', async () => {
    const jashim = request.agent(app);

    const res = await jashim
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'jashim@teslapool.test', password: DEMO_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Jashim', role: 'DRIVER' });
    const me = await jashim.get('/api/v1/auth/me');
    expect(me.body.user).toMatchObject({ name: 'Jashim', role: 'DRIVER' });
  });

  it('[I-AUTH-02] gives the same 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nusrat@teslapool.test', password: 'not-her-password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@teslapool.test', password: 'not-her-password' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
  });

  it('[I-AUTH-02] refuses a password that only matches because bcrypt ignores bytes after 72', async () => {
    const seventyTwo = 'a'.repeat(72);
    await prisma.user.update({
      where: { email: 'shirin@teslapool.test' },
      data: { passwordHash: await hashPassword(seventyTwo, 4) },
    });
    const login = (password: string) =>
      request(app).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: 'shirin@teslapool.test', password });

    expect((await login(`${seventyTwo}!`)).status).toBe(401); // bcrypt alone would say "match"
    expect((await login(seventyTwo)).status).toBe(200);
  });

  it('[I-AUTH-06] sets an httpOnly, SameSite=Lax session cookie that lasts 8 hours', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nusrat@teslapool.test', password: DEMO_PASSWORD });

    const cookie = sessionCookie(res) ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800'); // 8 * 60 * 60 seconds
    expect(cookie).not.toContain('Secure'); // plain http in local development and tests
  });

  it('[I-AUTH-06] marks the cookie Secure in production', async () => {
    const productionApp = createTestApp(prisma, { NODE_ENV: 'production' });

    const res = await request(productionApp)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nusrat@teslapool.test', password: DEMO_PASSWORD });

    expect(sessionCookie(res)).toContain('Secure');
  });

  it('[I-AUTH-06] refuses a login posted from another website', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'nusrat@teslapool.test', password: DEMO_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
    expect(sessionCookie(res)).toBeUndefined();
  });
});

describe('sessions', () => {
  let nusratId: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedCast(prisma, { bcryptCost: 4 });
    nusratId = (await prisma.user.findUniqueOrThrow({ where: { email: 'nusrat@teslapool.test' } })).id;
  });

  const meWith = (cookie?: string) => {
    const req = request(app).get('/api/v1/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('[I-AUTH-05] refuses /me without a session cookie', async () => {
    const res = await meWith();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('[I-AUTH-05] refuses tampered, expired and foreign-signed tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const sign = (payload: object, secret = testConfig.JWT_SECRET) =>
      jwt.sign(payload, secret, { algorithm: 'HS256', subject: nusratId });

    const valid = sign({ role: 'PASSENGER' });
    const tampered = `${valid.slice(0, -2)}${valid.endsWith('A') ? 'BB' : 'AA'}`;
    const expired = sign({ role: 'PASSENGER', iat: now - 9 * 3600, exp: now - 3600 });
    const foreign = sign({ role: 'DRIVER' }, 'someone-elses-secret-that-is-long-enough');

    expect((await meWith(`dtp_session=${valid}`)).status).toBe(200);
    for (const token of [tampered, expired, foreign]) {
      expect((await meWith(`dtp_session=${token}`)).status).toBe(401);
    }
  });

  it('[I-AUTH-05] ends the session when the account no longer exists', async () => {
    const token = jwt.sign({ role: 'PASSENGER' }, testConfig.JWT_SECRET, { algorithm: 'HS256', subject: nusratId });
    await prisma.user.delete({ where: { id: nusratId } });

    const res = await meWith(`dtp_session=${token}`);

    expect(res.status).toBe(401);
  });

  it('[I-AUTH-09] logout clears the cookie, and the browser is signed out', async () => {
    const nusrat = request.agent(app);
    await nusrat
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nusrat@teslapool.test', password: DEMO_PASSWORD });

    const logout = await nusrat.post('/api/v1/auth/logout').set('Origin', ORIGIN);

    expect(logout.status).toBe(204);
    expect(sessionCookie(logout)).toMatch(/^dtp_session=;.*Expires=Thu, 01 Jan 1970/);
    expect((await nusrat.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('rate limiting', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedCast(prisma, { bcryptCost: 4 });
  });

  it('[I-AUTH-07] blocks further login and register attempts from the same address with 429', async () => {
    const strictApp = createTestApp(prisma, { AUTH_RATE_LIMIT_MAX: 3 });
    const attempt = (password: string) =>
      request(strictApp).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: 'nusrat@teslapool.test', password });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt('guess')).status).toBe(401);
    }
    // Even the correct password is refused now: the limiter runs before the password check.
    const blocked = await attempt(DEMO_PASSWORD);
    const blockedRegister = await request(strictApp)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ name: 'Nusrat', email: 'nusrat2@teslapool.test', password: 'Mohakhali#3km' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers.ratelimit).toBeDefined(); // tells the client when to retry
    expect(blockedRegister.status).toBe(429);
  });
});
