import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, passkeyTable } from "@louez/db";
import { authInstance } from "@/lib/auth";
import { PasskeySetupPrompt } from "./passkey-setup-prompt";

/** The invitation is only useful immediately after proving ownership of the account. */
export const PasskeyEnrollment = async () => {
  const session = await authInstance.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) return null;
  const expiresAt = session.session.createdAt.getTime() + 10 * 60 * 1000;
  if (Date.now() >= expiresAt) return null;
  const [existing] = await db
    .select({ id: passkeyTable.id })
    .from(passkeyTable)
    .where(eq(passkeyTable.userId, session.user.id))
    .limit(1);
  if (existing) return null;
  return (
    <PasskeySetupPrompt userId={session.user.id} email={session.user.email} expiresAt={expiresAt} />
  );
};
