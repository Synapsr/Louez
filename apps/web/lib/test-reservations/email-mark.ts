import { AsyncLocalStorage } from "node:async_hooks";

import type { SendEmailOptions } from "@louez/email";

import { addTestReservationBanner, addTestReservationSubjectPrefix } from "./util.message-policy";

/** The "[Test]" mark of a test reservation's e-mails, in their language. */
export interface TestEmailMark {
  subjectPrefix: string;
  banner: string;
}

const current = new AsyncLocalStorage<TestEmailMark>();

/**
 * Runs a send with the mark on every e-mail it sends (message-policy.ts). Kept apart
 * from the policy, with no database, as lib/email/client.ts reads it.
 */
export function runWithTestEmailMark<T>(mark: TestEmailMark, work: () => Promise<T>): Promise<T> {
  return current.run(mark, work);
}

/** The e-mail as it goes out: marked when it is sent for a test reservation. */
export function markTestReservationEmail(options: SendEmailOptions): SendEmailOptions {
  const mark = current.getStore();
  if (!mark) return options;
  return {
    ...options,
    subject: addTestReservationSubjectPrefix(options.subject, mark.subjectPrefix),
    html: addTestReservationBanner(options.html, mark.banner),
  };
}
