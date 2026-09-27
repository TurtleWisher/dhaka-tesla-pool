import type { Express } from 'express';
import request from 'supertest';
import { DEMO_PASSWORD } from '../../src/db/seedCast.js';
import { ORIGIN } from './app.js';

/** A browser-like client that keeps its cookies between requests. */
export type SignedInAgent = ReturnType<typeof request.agent>;

/** Signs a seeded cast member in through the real login endpoint and returns their "browser". */
export async function signIn(app: Express, email: string): Promise<SignedInAgent> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Test sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
