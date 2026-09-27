import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

/** The smallest valid environment; each test changes one thing. */
const valid = {
  DATABASE_URL: 'postgresql://dtp:pw@localhost:5433/dhaka_tesla_pool',
  JWT_SECRET: 'a'.repeat(32),
};

describe('environment validation', () => {
  it('[U-ENV-01] applies safe defaults', () => {
    const env = loadEnv(valid);

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      FRONTEND_ORIGIN: 'http://localhost:3000',
      BCRYPT_COST: 12,
      AUTH_RATE_LIMIT_MAX: 10,
    });
  });

  it('[U-ENV-01] refuses to start without a long enough JWT_SECRET', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/at least 32 characters/);
  });

  it('[U-ENV-01] refuses the public example secret in production', () => {
    const exampleSecret = 'local-dev-only-change-me-0123456789abcdef';

    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', JWT_SECRET: exampleSecret })).toThrow(
      /public example value/,
    );
    expect(loadEnv({ ...valid, JWT_SECRET: exampleSecret }).JWT_SECRET).toBe(exampleSecret);
  });

  it('[U-ENV-01] normalises FRONTEND_ORIGIN and rejects non-web URLs', () => {
    expect(loadEnv({ ...valid, FRONTEND_ORIGIN: 'https://pool.example.com/' }).FRONTEND_ORIGIN).toBe(
      'https://pool.example.com',
    );
    expect(() => loadEnv({ ...valid, FRONTEND_ORIGIN: 'ftp://pool.example.com' })).toThrow(/FRONTEND_ORIGIN/);
  });

  it('[U-ENV-01] keeps BCRYPT_COST within what bcrypt supports', () => {
    expect(loadEnv({ ...valid, BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
    expect(() => loadEnv({ ...valid, BCRYPT_COST: '3' })).toThrow(/BCRYPT_COST/);
    expect(() => loadEnv({ ...valid, BCRYPT_COST: '16' })).toThrow(/BCRYPT_COST/);
  });
});
