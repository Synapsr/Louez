import { db, stores } from "@louez/db";
import { resolveAccountActor, resolveStoreActor } from "@louez/api/platform/actor";
import { platformErrors } from "@louez/api/platform/errors";
import type { ApiPorts } from "@louez/api/platform/ports";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import { consumeRateLimit, rateLimitKey } from "@louez/api/platform/rate-limit";
import { eq } from "drizzle-orm";

import type { McpRequestContext } from "./context";

/**
 * Resolves the context of one MCP request, as `storeProcedure` does for a
 * call: the credential (an API key until OAuth lands), the store and the role
 * held there now, and the plan's API access. Throws the platform's errors.
 */
export async function resolveMcpContext(input: {
  headers: Headers;
  ports: ApiPorts;
}): Promise<McpRequestContext> {
  const account = await resolveAccountActor({ transport: "mcp", headers: input.headers });
  const actor = await resolveStoreActor(account, {
    headers: input.headers,
    requestedStoreId: input.headers.get(STORE_HEADER) ?? undefined,
  });

  const features = await input.ports.planFeatures(actor.storeId);
  if (!features.apiAccess) throw platformErrors.apiAccessNotInPlan();

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, actor.storeId),
    columns: { name: true },
  });
  if (!store) throw platformErrors.noStore();

  return {
    actor,
    storeId: actor.storeId,
    userId: actor.credential.userId,
    storeName: store.name,
    headers: input.headers,
    ports: input.ports,
    countCall: async () => {
      const limit = await consumeRateLimit(rateLimitKey(actor.credential));
      if (!limit.allowed) throw platformErrors.rateLimited(limit.retryAfterSeconds);
    },
  };
}
