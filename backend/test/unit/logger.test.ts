import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';

describe('logger redaction', () => {
  it('[U-LOG-01] never writes session cookies, auth headers or passwords to the log', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger('info', sink);

    logger.info(
      {
        req: { headers: { cookie: 'dtp_session=secret-token', authorization: 'Bearer secret-token' } },
        res: { headers: { 'set-cookie': 'dtp_session=secret-token; HttpOnly' } },
        body: { password: 'TeslaPool#2026' },
      },
      'request completed',
    );

    const output = lines.join('');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('TeslaPool#2026');
    expect(output.match(/\[Redacted\]/g)).toHaveLength(4);
  });
});
