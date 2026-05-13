import { createFsDrain } from 'evlog/fs';
import { createEvlog } from 'evlog/next';
import { createInstrumentation } from 'evlog/next/instrumentation';

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

export const { withEvlog, useLogger, log, createError, createEvlogError } =
  createEvlog(evlogOptions);

export const { register, onRequestError } =
  createInstrumentation(evlogOptions);
