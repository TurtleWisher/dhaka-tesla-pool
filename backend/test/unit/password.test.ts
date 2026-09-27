import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';

describe('password hashing', () => {
  it('[U-AUTH-02] never returns the password itself, and records the cost in the hash', async () => {
    const hash = await hashPassword('TeslaPool#2026', 4);

    expect(hash).not.toContain('TeslaPool#2026');
    expect(hash).toMatch(/^\$2b\$04\$/); // bcrypt version 2b, cost 04
  });

  it('[U-AUTH-02] accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('TeslaPool#2026', 4);

    expect(await verifyPassword('TeslaPool#2026', hash)).toBe(true);
    expect(await verifyPassword('teslapool#2026', hash)).toBe(false);
  });

  it('[U-AUTH-02] salts every hash, so the same password gives different hashes', async () => {
    const first = await hashPassword('TeslaPool#2026', 4);
    const second = await hashPassword('TeslaPool#2026', 4);

    expect(first).not.toBe(second);
    expect(await verifyPassword('TeslaPool#2026', second)).toBe(true);
  });
});
