import { desc, eq } from "drizzle-orm";
import { db, passkeyTable } from "@louez/db";
import { PasskeySettingsCard } from "./passkey-settings-card";

export const PasskeySettings = async ({ userId, email }: { userId: string; email: string }) => {
  const passkeys = await db
    .select({
      id: passkeyTable.id,
      name: passkeyTable.name,
      createdAt: passkeyTable.createdAt,
    })
    .from(passkeyTable)
    .where(eq(passkeyTable.userId, userId))
    .orderBy(desc(passkeyTable.createdAt));

  return <PasskeySettingsCard passkeys={passkeys} email={email} userId={userId} />;
};
