"use server";

import { and, eq, isNull } from "drizzle-orm";

import { db, users } from "@louez/db";
import { type ReeentIntroInput, reeentIntroSchema } from "@louez/validations";

import { persistSignupOrigin } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";

/**
 * Records the first time the reeent education step was acknowledged so the
 * onboarding gate remains stable across browsers and cookie expiration, and
 * stores the pro/particulier answer the step asks up front (ADR 010).
 */
export async function acknowledgeReeentIntro(input: ReeentIntroInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
  }

  const parsed = reeentIntroSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "errors.invalidData" };
  }

  await persistSignupOrigin(session.user.id);
  await db
    .update(users)
    .set({ reeentIntroAcknowledgedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, session.user.id), isNull(users.reeentIntroAcknowledgedAt)));

  // "Professionnel" stays unwritten: the profile step refines it into one of the
  // three professional options. "Particulier" is already the final value, but it
  // never overwrites an answer the user gave before.
  if (parsed.data.status === "individual") {
    await db
      .update(users)
      .set({ businessType: "individual", updatedAt: new Date() })
      .where(and(eq(users.id, session.user.id), isNull(users.businessType)));
  }

  return { success: true };
}
