import { getMarketplaceCohortStatus } from "@louez/api/services";
import { NextRequest } from "next/server";

import { env } from "@/env";
import { apiJson as json } from "@/lib/api-service-response";
import { useLogger, withEvlog } from "@/lib/evlog";

import { handleCatalogCohortGet } from "./handler";

const handleGet = async (request: NextRequest) => {
  const logger = useLogger();

  try {
    return await handleCatalogCohortGet({
      request,
      secret: env.MARKETPLACE_CATALOG_SECRET,
      getCohortStatus: () => getMarketplaceCohortStatus(env.REEENT_LAUNCH_COHORT_SIZE),
    });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error("Catalog cohort request failed"));
    return json({ error: "errors.internalServerError" }, 500);
  }
};

export const GET = withEvlog(handleGet);
