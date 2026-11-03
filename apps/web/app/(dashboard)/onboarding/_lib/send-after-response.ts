import "server-only";

import { after } from "next/server";

/**
 * Sends onboarding analytics once the response is out, so the owner does not
 * wait for PostHog before seeing the next step. Outside a request scope (a
 * script or a test calling the action), `after` throws and the task runs now.
 * The analytics helpers swallow their own errors.
 */
export const sendAfterResponse = (task: () => Promise<unknown>): void => {
  try {
    after(task);
  } catch {
    void task();
  }
};
