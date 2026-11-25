import "server-only";

import { and, asc, isNotNull, like, lte, notExists, sql } from "drizzle-orm";

import { db, storeMembers, stores, users } from "@louez/db";

import { deleteAccountData } from "@/lib/account-deletion/account-deletion";
import { accountDeletionRepository } from "@/lib/account-deletion/database-repository";
import type { AccountDeletionExternalServices } from "@/lib/account-deletion/account-deletion";
import { deleteStoragePrefix } from "@/lib/account-deletion/external-services";
import { log } from "@/lib/evlog";

import { DEMO_OWNER_EMAIL_DOMAIN, DEMO_OWNER_EMAIL_PREFIX } from "./constants";

/**
 * What a demo account holds outside the database: at most the files a visitor
 * uploaded. Nothing at Stripe, Google, an insurer or a phone provider, and no
 * analytics person to erase (lib/demo/demo-analytics.ts writes none). A file
 * that cannot be removed is logged, and the account is deleted anyway.
 */
const demoExternalServices: AccountDeletionExternalServices = {
  cleanup: async (context) => {
    for (const prefix of context.externalResources.storagePrefixes) {
      try {
        await deleteStoragePrefix(prefix);
      } catch (error) {
        log.warn(
          "demo",
          `files of a demo store not removed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  },
};

/** Demo owners one run deletes, so a backlog never holds the cron for long. */
const BATCH = 25;
/** An owner left without a store (a start that failed) after this long is deleted too. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Deletes the demo stores past `demo_expires_at`, with their owner accounts,
 * through the account deletion every account goes through (its purge knows
 * every table of a store). Then the demo owners a failed start left without a
 * store. Run by the cron every ten minutes.
 */
export async function purgeExpiredDemoStores(
  now = new Date(),
): Promise<{ deleted: number; failed: number }> {
  const expired = await db
    .selectDistinct({ userId: stores.userId })
    .from(stores)
    .where(and(isNotNull(stores.demoVertical), lte(stores.demoExpiresAt, now)))
    .orderBy(asc(stores.userId))
    .limit(BATCH);

  const orphans = await db
    .select({ userId: users.id })
    .from(users)
    .where(
      and(
        like(users.email, `${DEMO_OWNER_EMAIL_PREFIX}%@${DEMO_OWNER_EMAIL_DOMAIN}`),
        lte(users.createdAt, new Date(now.getTime() - ORPHAN_GRACE_MS)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(storeMembers)
            .where(sql`${storeMembers.userId} = ${users.id}`),
        ),
      ),
    )
    .limit(BATCH);

  let deleted = 0;
  let failed = 0;
  for (const userId of new Set([...expired, ...orphans].map((row) => row.userId))) {
    try {
      const result = await deleteAccountData({
        userId,
        repository: accountDeletionRepository,
        externalServices: demoExternalServices,
      });
      if (result.status === "deleted") deleted += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      log.warn(
        "demo",
        `cleanup of a demo owner failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { deleted, failed };
}
