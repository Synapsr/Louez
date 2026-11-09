import { createFsDrain } from 'evlog/fs';
import { createEvlog } from 'evlog/next';
import { createInstrumentation } from 'evlog/next/instrumentation';

import { redactLogValue } from '@/lib/handoffs/handoff-privacy';

const fsDrain = createFsDrain({
  dir: '.evlog/logs',
  maxFiles: 14,
  maxSizePerFile: 10 * 1024 * 1024,
  pretty: false,
});

/** Every event is written without the secrets of a handoff's URL. */
const drain: typeof fsDrain = (ctx) => fsDrain(redactLogValue(ctx));

const evlogOptions = {
  service: 'louez-web',
  sampling: {
    keep: [{ status: 400 }, { status: 500 }, { duration: 1000 }],
  },
  drain,
};

export const { withEvlog, useLogger, log, createError, createEvlogError } =
  createEvlog(evlogOptions);

const instrumentation = createInstrumentation(evlogOptions);

export const { register } = instrumentation;

/**
 * Next.js's request errors, logged with the path and the error redacted: the
 * console line is printed before the drain sees it.
 */
export const onRequestError: typeof instrumentation.onRequestError = (error, request, context) => {
  const redacted = Object.assign(new Error(redactLogValue(error.message)), {
    digest: error.digest,
    stack: error.stack === undefined ? undefined : redactLogValue(error.stack),
  });
  instrumentation.onRequestError(redacted, { ...request, path: redactLogValue(request.path) }, context);
};
