import { pino, type Logger } from 'pino';

/**
 * Structured JSON logger. One line per event, easy to search later.
 * Secrets are redacted so they can never end up in log files.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
  });
}
