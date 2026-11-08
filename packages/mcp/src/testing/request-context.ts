/**
 * A request context built in memory, for tests of the hand-written tools: the
 * full server and the per-request resolver read the database.
 */
import type { ApiKeyPermissions } from "@louez/db";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { normalizeScopes } from "@louez/api/platform/permissions";
import type { MemberRole } from "@louez/utils";

import type { McpRequestContext } from "../auth/context";

/**
 * A request context as `resolveMcpContext` builds it for an API key, without
 * the database: the key's permissions, the owner's role (owner by default),
 * and no rate limit. `confirmSensitive` is the key's setting (on by default,
 * as for a new key); a test of a sensitive tool's effects turns it off.
 */
export function testRequestContext(input: {
  storeId: string;
  userId: string;
  storeName?: string;
  role?: MemberRole;
  apiKeyId?: string;
  permissions: Partial<ApiKeyPermissions>;
  confirmSensitive?: boolean;
}): McpRequestContext {
  return {
    actor: {
      transport: "mcp",
      isPlatformAdmin: false,
      storeId: input.storeId,
      role: input.role ?? "owner",
      credential: {
        kind: "api_key",
        id: input.apiKeyId ?? "key_test",
        clientName: "Test key",
        userId: input.userId,
        email: null,
        storeId: input.storeId,
        stores: null,
        scopes: normalizeScopes(input.permissions),
        confirmSensitive: input.confirmSensitive ?? true,
        bundles: null,
      },
    },
    storeChosen: true,
    multiStore: false,
    noStore: false,
    storeArgument: false,
    storeError: null,
    listingRole: input.role ?? "owner",
    storeId: input.storeId,
    userId: input.userId,
    storeName: input.storeName ?? "Test store",
    storeOnline: true,
    headers: new Headers(),
    ports: {
      planFeatures: async () => ({ apiAccess: true }),
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
    },
    countCall: async () => undefined,
  };
}
