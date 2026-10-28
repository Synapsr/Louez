import { auth } from "@/lib/auth";
import type { BillingSession } from "@/lib/billing/handoff-access";

/** The signed-in user of `/dashboard/billing` and its return, or null. */
export async function getBillingSession(): Promise<BillingSession | null> {
  const user = (await auth())?.user;
  return user?.id ? { userId: user.id, email: user.email ?? null } : null;
}
