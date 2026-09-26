import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';

// A silent logger keeps test output readable.
const app = createApp(createLogger('silent'));

describe('GET /health', () => {
  it('[I-HEALTH-01] reports that the API is up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('[I-HEALTH-01] sends security headers and a request id', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff'); // from helmet
    expect(res.headers['x-powered-by']).toBeUndefined(); // helmet hides "Express"
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
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
