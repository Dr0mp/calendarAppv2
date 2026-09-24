import pino from 'pino';

/** @param {{logLevel: string}} config */
export function createLogger(config) {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        'password', '*.password', '*.currentPassword', '*.newPassword', 'req.headers.cookie',
        'req.headers["x-csrf-token"]', '*.token', '*.email', '*.guest_names', '*.guestNames',
      ],
      censor: '[redacted]',
    },
    base: undefined,
  });
}
