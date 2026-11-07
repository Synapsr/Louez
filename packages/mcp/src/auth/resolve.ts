import { db, stores } from "@louez/db";
import {
  connectionStores,
  resolveAccountActor,
  resolveStoreActor,
  type AccountActor,
  type StoreActor,
} from "@louez/api/platform/actor";
import { platformErrors } from "@louez/api/platform/errors";
import type { ApiPorts } from "@louez/api/platform/ports";
import { consumeRateLimit, rateLimitKey } from "@louez/api/platform/rate-limit";
import { eq } from "drizzle-orm";

import type { McpRequestContext } from "./context";

/** Who calls: an API key or an OAuth access token, checked in full. Throws the platform's errors. */
export function resolveMcpAccount(headers: Headers): Promise<AccountActor> {
  return resolveAccountActor({ transport: "mcp", headers });
}

/**
 * Resolves the context of one MCP request, as `storeProcedure` does for a
 * call: the store and the role held there now, and the plan's API access.
 *
 * `requestedStoreId` is the store the request names (the `Louez-Store`
 * header, or the `storeId` argument of its tool call). A connection over
 * several stores that names none gets a context without a chosen store: its
 * tools are listed, and a call that needs a store asks for one.
 */
export async function resolveMcpContext(input: {
  account: AccountActor;
  headers: Headers;
  ports: ApiPorts;
  requestedStoreId?: string;
  /** Answered by the tool call instead of running (see `McpRequestContext.storeError`). */
  storeError?: Error;
}): Promise<McpRequestContext> {
  const { account } = input;
  const { credential } = account;

  const reachable =
    credential.kind === "oauth" && !credential.storeId ? await connectionStores(account) : [];
  const multiStore = reachable.length > 1;

  let actor: StoreActor;
  let storeChosen = true;
  if (multiStore && !input.requestedStoreId) {
    storeChosen = false;
    actor = { ...account, storeId: reachable[0].id, role: reachable[0].role };
  } else {
    actor = await resolveStoreActor(account, {
      headers: input.headers,
      requestedStoreId: input.requestedStoreId,
    });
  }
  const listingRole =
    !storeChosen && reachable.some((store) => store.role === "owner") ? "owner" : actor.role;

  const features = await input.ports.planFeatures(actor.storeId);
  if (!features.apiAccess) throw platformErrors.apiAccessNotInPlan();

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, actor.storeId),
    columns: { name: true },
  });
  if (!store) throw platformErrors.noStore();

  return {
    actor,
    storeChosen,
    multiStore,
    storeError: input.storeError ?? null,
    listingRole,
    storeId: actor.storeId,
    userId: credential.userId,
    storeName: store.name,
    headers: input.headers,
    ports: input.ports,
    countCall: async () => {
      const limit = await consumeRateLimit(rateLimitKey(credential));
      if (!limit.allowed) throw platformErrors.rateLimited(limit.retryAfterSeconds);
    },
  };
}
