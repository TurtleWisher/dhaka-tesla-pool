import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { createTestApp } from '../helpers/app.js';
import { createTestPrisma } from '../helpers/db.js';

const prisma = createTestPrisma();
const app = createTestApp(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /health', () => {
  it('[I-HEALTH-01] reports that the API and the database are up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('[I-HEALTH-01] sends security headers and a request id', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff'); // from helmet
    expect(res.headers['x-powered-by']).toBeUndefined(); // helmet hides "Express"
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('[I-HEALTH-02] returns 503 when the database cannot be reached', async () => {
    // Port 1 on localhost: nothing listens there, so every connection fails immediately.
    const unreachable = createPrismaClient('postgresql://nobody:nothing@localhost:1/nowhere');
    const brokenApp = createTestApp(unreachable);

    const res = await request(brokenApp).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'unreachable' });
    await unreachable.$disconnect();
  });
});

describe('error handling', () => {
  it('[I-ERR-01] returns the standard error envelope for an unknown route', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /does-not-exist not found' },
    });
  });

  it('[I-ERR-01] rejects malformed JSON with 400 and no stack trace', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"pickupZone": "BANANI"'); // missing closing brace

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });

  it('[I-ERR-01] rejects bodies larger than 10kb with 413', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'x'.repeat(11 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
