import { AsyncLocalStorage } from "node:async_hooks";

import type { SendEmailOptions } from "@louez/email";

import { addTestReservationBanner, addTestReservationSubjectPrefix } from "./util.message-policy";

/** The "[Test]" mark of a test reservation's e-mails, in their language, and their one recipient. */
export interface TestEmailMark {
  subjectPrefix: string;
  banner: string;
  /**
   * The member who started the test, the reservation's customer (the checkout
   * writes their account e-mail on it): every e-mail of the test goes to them
   * alone, the store's and the owner's ones too.
   */
  recipient: string;
}

const current = new AsyncLocalStorage<TestEmailMark>();

/**
 * Runs a send with the mark on every e-mail it sends (message-policy.ts). Kept apart
 * from the policy, with no database, as lib/email/client.ts reads it.
 */
export function runWithTestEmailMark<T>(mark: TestEmailMark, work: () => Promise<T>): Promise<T> {
  return current.run(mark, work);
}

/**
 * The e-mail as it goes out: for a test reservation, marked and sent to the
 * member who started it, whoever it was addressed to.
 */
export function markTestReservationEmail(options: SendEmailOptions): SendEmailOptions {
  const mark = current.getStore();
  if (!mark) return options;
  return {
    ...options,
    to: mark.recipient,
    subject: addTestReservationSubjectPrefix(options.subject, mark.subjectPrefix),
    html: addTestReservationBanner(options.html, mark.banner),
  };
}
