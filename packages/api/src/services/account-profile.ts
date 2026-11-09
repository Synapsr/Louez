import { db, users } from "@louez/db";
import { eq } from "drizzle-orm";

import { platformErrors } from "../platform/errors";

/** The user's id and display name; an account deleted since the call began is signed out. */
export async function getAccountProfile(
  userId: string,
): Promise<{ id: string; name: string | null }> {
  const [row] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw platformErrors.unauthenticated();
  return { id: row.id, name: row.name?.trim() || null };
}
