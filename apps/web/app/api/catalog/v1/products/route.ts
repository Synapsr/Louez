import { ApiServiceError, listProductSnapshots } from "@louez/api/services";
import { catalogListRouteQuerySchema } from "@louez/validations";
import { NextRequest } from "next/server";

import { env } from "@/env";
import { apiJson as json, statusFromServiceCode } from "@/lib/api-service-response";
import { verifyCatalogRequest } from "@/lib/catalog-auth";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCanonicalUrl } from "@/lib/seo";

const handleGet = async (request: NextRequest) => {
  const logger = useLogger();

  try {
    if (
      !(await verifyCatalogRequest({
        request,
        secret: env.MARKETPLACE_CATALOG_SECRET,
      }))
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    const parsed = catalogListRouteQuerySchema.safeParse({
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return json({ error: "errors.invalidData" }, 400);
    }

    return json(
      await listProductSnapshots({
        ...parsed.data,
        getCanonicalUrl,
        mediaBaseUrl: env.NEXT_PUBLIC_APP_URL,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return json({ error: error.key, details: error.details }, statusFromServiceCode(error.code));
    }

    logger.error(error instanceof Error ? error : new Error("Catalog products request failed"));
    return json({ error: "errors.internalServerError" }, 500);
  }
};

export const GET = withEvlog(handleGet);
