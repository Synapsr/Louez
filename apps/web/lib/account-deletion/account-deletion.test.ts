import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deleteAccountData,
  getAccountDeletionPreview,
  type AccountDeletionContext,
  type AccountDeletionExternalServices,
  type AccountDeletionRepository,
} from "./account-deletion";

const createContext = (
  overrides: Partial<AccountDeletionContext> = {},
): AccountDeletionContext => ({
  user: {
    id: "user-1",
    email: "owner@example.com",
  },
  memberOnlyStoreCount: 0,
  stores: [
    {
      id: "store-1",
      name: "My store",
      otherMemberCount: 0,
      legalRecordCount: 0,
      businessDocumentCount: 0,
    },
  ],
  externalResources: {
    storagePrefixes: ["store-1/", "users/user-1/"],
    stripeAccountIds: [],
    stripeCustomerIds: [],
    stripeSubscriptionIds: [],
    googleAuthTokens: [],
    googleCalendarConnections: [],
    superPdpTokensEncrypted: [],
    tulipProductIds: [],
    phoneNumberBindings: [],
  },
  ...overrides,
});

const createRepository = (
  context: AccountDeletionContext | null,
  events: string[] = [],
): AccountDeletionRepository => ({
  getContext: async () => context,
  purgeOwnedData: async (_context, options) => {
    events.push("locked");
    await options.beforePurge();
    events.push("database");
    if (options.reason) {
      events.push(`reason:${options.reason}`);
    }
    return {
      storesDeleted: context?.stores.length ?? 0,
      legalRecordsRetained:
        context?.stores.reduce((total, store) => total + store.legalRecordCount, 0) ?? 0,
    };
  },
});

test("allows deletion when every owned store has no other member", async () => {
  const preview = await getAccountDeletionPreview({
    userId: "user-1",
    repository: createRepository(createContext()),
  });

  assert.deepEqual(preview, {
    status: "ready",
    email: "owner@example.com",
    stores: [{ id: "store-1", name: "My store" }],
    membershipsToLeave: 0,
    legalRecordsToRetain: 0,
    businessDocumentsToDelete: 0,
  });
});

test("leaves member-only stores without deleting them", async () => {
  const context = createContext({
    memberOnlyStoreCount: 2,
    stores: [],
  });

  const preview = await getAccountDeletionPreview({
    userId: "user-1",
    repository: createRepository(context),
  });

  assert.deepEqual(preview, {
    status: "ready",
    email: "owner@example.com",
    stores: [],
    membershipsToLeave: 2,
    legalRecordsToRetain: 0,
    businessDocumentsToDelete: 0,
  });
});

test("discloses business documents to delete and Louez billing records to retain", async () => {
  const context = createContext({
    stores: [
      {
        id: "store-1",
        name: "First store",
        otherMemberCount: 0,
        legalRecordCount: 2,
        businessDocumentCount: 4,
      },
      {
        id: "store-2",
        name: "Second store",
        otherMemberCount: 0,
        legalRecordCount: 1,
        businessDocumentCount: 3,
      },
    ],
  });

  const preview = await getAccountDeletionPreview({
    userId: "user-1",
    repository: createRepository(context),
  });

  assert.equal(preview.status, "ready");
  if (preview.status === "ready") {
    assert.equal(preview.businessDocumentsToDelete, 7);
    assert.equal(preview.legalRecordsToRetain, 3);
  }
});

test("blocks deletion while an owned store still has another member", async () => {
  const context = createContext({
    stores: [
      {
        id: "store-1",
        name: "Shared store",
        otherMemberCount: 2,
        legalRecordCount: 0,
        businessDocumentCount: 0,
      },
    ],
  });

  const preview = await getAccountDeletionPreview({
    userId: "user-1",
    repository: createRepository(context),
  });

  assert.deepEqual(preview, {
    status: "blocked",
    reason: "shared-store",
    stores: [{ id: "store-1", name: "Shared store", otherMemberCount: 2 }],
  });
});

test("locks and rechecks owned stores before cleaning external resources", async () => {
  const events: string[] = [];
  const context = createContext();
  const externalServices: AccountDeletionExternalServices = {
    cleanup: async () => {
      events.push("external");
    },
  };

  const result = await deleteAccountData({
    userId: "user-1",
    repository: createRepository(context, events),
    externalServices,
  });

  assert.deepEqual(events, ["locked", "external", "database"]);
  assert.deepEqual(result, {
    status: "deleted",
    storesDeleted: 1,
    legalRecordsRetained: 0,
  });
});

test("keeps database data intact when external cleanup fails", async () => {
  const events: string[] = [];
  const context = createContext();
  const externalServices: AccountDeletionExternalServices = {
    cleanup: async () => {
      events.push("external");
      throw new Error("storage unavailable");
    },
  };

  await assert.rejects(
    deleteAccountData({
      userId: "user-1",
      repository: createRepository(context, events),
      externalServices,
      reason: "missing_features",
    }),
    /storage unavailable/,
  );
  assert.deepEqual(events, ["locked", "external"]);
});

test("does not clean external resources when the locked ownership check fails", async () => {
  const events: string[] = [];
  const context = createContext();
  const repository: AccountDeletionRepository = {
    getContext: async () => context,
    purgeOwnedData: async () => {
      events.push("locked");
      throw new Error("Account deletion blocked by a shared store");
    },
  };

  await assert.rejects(
    deleteAccountData({
      userId: "user-1",
      repository,
      externalServices: {
        cleanup: async () => {
          events.push("external");
        },
      },
    }),
    /shared store/,
  );
  assert.deepEqual(events, ["locked"]);
});

test("records only a predefined anonymous departure reason with a successful purge", async () => {
  const events: string[] = [];

  const result = await deleteAccountData({
    userId: "user-1",
    repository: createRepository(createContext(), events),
    externalServices: {
      cleanup: async () => {
        events.push("external");
      },
    },
    reason: "missing_features",
  });

  assert.equal(result.status, "deleted");
  assert.deepEqual(events, ["locked", "external", "database", "reason:missing_features"]);
});
