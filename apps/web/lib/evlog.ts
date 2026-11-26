import { initLogger, type RedactConfig } from 'evlog';
import { createFsDrain } from 'evlog/fs';
import { createEvlog } from 'evlog/next';
import { createInstrumentation } from 'evlog/next/instrumentation';

import { LOG_SECRET_PATTERNS, REDACTED } from '@louez/api/platform/redact';

const drain = createFsDrain({
  dir: '.evlog/logs',
  maxFiles: 14,
  maxSizePerFile: 10 * 1024 * 1024,
  pretty: false,
});

const evlogOptions = {
  service: 'louez-web',
  sampling: {
    keep: [{ status: 400 }, { status: 500 }, { duration: 1000 }],
  },
  drain,
};

/**
 * Applied to every event before it is printed or drained: the secrets of a
 * handoff's URLs and of a partner's space (packages/api platform/redact.ts),
 * and in production evlog's own personal-data maskers, as without this option.
 */
export const evlogRedact: RedactConfig = {
  patterns: [...LOG_SECRET_PATTERNS],
  replacement: REDACTED,
  ...(process.env.NODE_ENV === 'production' ? {} : { builtins: false }),
};

/**
 * `text` with the secrets `evlogRedact` replaces in every event, for a line
 * printed outside the logger: the e-mail transport's development log.
 */
export const redactLogText = (text: string): string =>
  LOG_SECRET_PATTERNS.reduce((result, pattern) => {
    pattern.lastIndex = 0;
    return result.replace(pattern, REDACTED);
  }, text);

export const { withEvlog, useLogger, log, createError, createEvlogError } =
  createEvlog(evlogOptions);

const instrumentation = createInstrumentation(evlogOptions);

export const { onRequestError } = instrumentation;

/**
 * Sets the logger up once per server. The instrumentation's own setup locks
 * the logger, so request handlers never set it up again without the
 * redaction, but it takes no `redact` option: the full configuration is
 * applied right after it.
 */
export function register() {
  instrumentation.register();
  initLogger({
    env: { service: evlogOptions.service },
    sampling: evlogOptions.sampling,
    drain: evlogOptions.drain,
    redact: evlogRedact,
  });
}
