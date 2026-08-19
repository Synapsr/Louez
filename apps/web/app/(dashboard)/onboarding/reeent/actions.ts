"use server";

import { markReeentIntroSeen } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";

/**
 * Records that the reeent education step has been read, so the onboarding gate
 * lets the user move on instead of bouncing them back. Nothing is written to
 * the database: the step is informational and carries no eligibility.
 */
export async function acknowledgeReeentIntro() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
  }

  await markReeentIntroSeen();
  return { success: true };
}
