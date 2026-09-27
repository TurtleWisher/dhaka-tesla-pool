import { type DestinationStream, pino, type Logger } from 'pino';

/**
 * Structured JSON logger. One line per event, easy to search later.
 * Secrets are redacted so they can never end up in log files.
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie', // incoming session cookie
        'res.headers["set-cookie"]', // outgoing session cookie (after login)
        '*.password',
      ],
    },
    destination,
  );
}
