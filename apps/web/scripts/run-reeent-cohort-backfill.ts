import { resolve } from "node:path";

import { config } from "dotenv";
import { and, asc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";

const appRoot = process.cwd();
const repositoryRoot = resolve(appRoot, "../..");
config({ path: resolve(appRoot, ".env.local"), quiet: true });
config({ path: resolve(appRoot, ".env"), quiet: true });
config({ path: resolve(repositoryRoot, ".env.local"), quiet: true });
config({ path: resolve(repositoryRoot, ".env"), quiet: true });

async function main() {
  const [{ db, storeMarketplaceChannels }, { env }] = await Promise.all([
    import("@louez/db"),
    import("../env"),
  ]);
  const cohortSize = env.REEENT_LAUNCH_COHORT_SIZE;

  const result = await db.transaction(async (tx) => {
    const [{ waivedCount }] = await tx
      .select({ waivedCount: sql<number>`count(*)` })
      .from(storeMarketplaceChannels)
      .where(isNotNull(storeMarketplaceChannels.lifetimeFeeWaiverAt));
    const alreadyWaived = Number(waivedCount) || 0;
    const remainingSlots = Math.max(0, cohortSize - alreadyWaived);
    if (remainingSlots === 0) {
      return { cohortSize, alreadyWaived, remainingSlots, assigned: 0 };
    }

    const [{ maxRank }] = await tx
      .select({ maxRank: max(storeMarketplaceChannels.cohortRank) })
      .from(storeMarketplaceChannels);
    const nextRank = (maxRank ?? 0) + 1;
    const candidates = await tx
      .select({
        id: storeMarketplaceChannels.id,
        publishedAt: storeMarketplaceChannels.publishedAt,
        createdAt: storeMarketplaceChannels.createdAt,
      })
      .from(storeMarketplaceChannels)
      .where(
        and(
          isNotNull(storeMarketplaceChannels.publishedAt),
          isNull(storeMarketplaceChannels.lifetimeFeeWaiverAt),
          isNull(storeMarketplaceChannels.cohortRank),
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(${storeMarketplaceChannels.publishedAt}, ${storeMarketplaceChannels.createdAt})`,
        ),
        asc(storeMarketplaceChannels.createdAt),
        asc(storeMarketplaceChannels.id),
      )
      .limit(remainingSlots)
      .for("update");

    for (const [index, candidate] of candidates.entries()) {
      await tx
        .update(storeMarketplaceChannels)
        .set({
          cohortRank: nextRank + index,
          lifetimeFeeWaiverAt: candidate.publishedAt ?? candidate.createdAt,
        })
        .where(
          and(
            eq(storeMarketplaceChannels.id, candidate.id),
            isNull(storeMarketplaceChannels.lifetimeFeeWaiverAt),
            isNull(storeMarketplaceChannels.cohortRank),
          ),
        );
    }

    return {
      cohortSize,
      alreadyWaived,
      remainingSlots,
      assigned: candidates.length,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

main()
  .then((code) => {
    // The shared DB pool keeps the event loop alive after the backfill completes.
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
