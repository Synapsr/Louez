import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";

interface ResolveContext {
  parentURL?: string;
}

interface ResolveResult {
  shortCircuit?: boolean;
  url: string;
}

type NextResolve = (specifier: string, context: ResolveContext) => ResolveResult;

const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return {
        shortCircuit: true,
        url: "node:module",
      };
    }
    return nextResolve(specifier, context);
  },
});

test("deletes a test-mode Standard connected account", async () => {
  const { cleanupStripeConnectedAccounts } = await import("./external-services");
  const deletedAccountIds: string[] = [];
  const stripeAdapter = {
    isLiveMode: false,
    retrieveAccount: async () => ({
      type: "standard" as const,
    }),
    deleteAccount: async (accountId: string) => {
      deletedAccountIds.push(accountId);
      return { id: accountId, deleted: true };
    },
  };

  await cleanupStripeConnectedAccounts(["acct_test"], stripeAdapter);

  assert.deepEqual(deletedAccountIds, ["acct_test"]);
});

test("blocks deletion while a live Standard connected account remains linked", async () => {
  const { cleanupStripeConnectedAccounts } = await import("./external-services");
  let deleteCalled = false;
  const stripeAdapter = {
    isLiveMode: true,
    retrieveAccount: async () => ({
      type: "standard" as const,
    }),
    deleteAccount: async () => {
      deleteCalled = true;
      return { id: "acct_live", deleted: true };
    },
  };

  await assert.rejects(
    cleanupStripeConnectedAccounts(["acct_live"], stripeAdapter),
    /must be disconnected from the Stripe Dashboard/,
  );
  assert.equal(deleteCalled, false);
});

test("deletes a live connected account when the platform owns loss liability", async () => {
  const { cleanupStripeConnectedAccounts } = await import("./external-services");
  const deletedAccountIds: string[] = [];
  const stripeAdapter = {
    isLiveMode: true,
    retrieveAccount: async () => ({
      type: "express" as const,
      controller: { losses: { payments: "application" } },
    }),
    deleteAccount: async (accountId: string) => {
      deletedAccountIds.push(accountId);
      return { id: accountId, deleted: true };
    },
  };

  await cleanupStripeConnectedAccounts(["acct_express"], stripeAdapter);

  assert.deepEqual(deletedAccountIds, ["acct_express"]);
});

test("treats a missing Stripe connected account as already removed", async () => {
  const { cleanupStripeConnectedAccounts } = await import("./external-services");
  let deleteCalled = false;
  const missingError = Object.assign(new Error("No such account"), {
    code: "resource_missing",
  });
  const stripeAdapter = {
    isLiveMode: true,
    retrieveAccount: async () => Promise.reject(missingError),
    deleteAccount: async () => {
      deleteCalled = true;
      return { id: "acct_missing", deleted: true };
    },
  };

  await cleanupStripeConnectedAccounts(["acct_missing"], stripeAdapter);

  assert.equal(deleteCalled, false);
});

test("does not partially delete connected accounts when a later Standard live account blocks", async () => {
  const { cleanupStripeConnectedAccounts } = await import("./external-services");
  const deletedAccountIds: string[] = [];
  const stripeAdapter = {
    isLiveMode: true,
    retrieveAccount: async (accountId: string) => ({
      type: accountId === "acct_standard" ? ("standard" as const) : ("express" as const),
    }),
    deleteAccount: async (accountId: string) => {
      deletedAccountIds.push(accountId);
      return { id: accountId, deleted: true };
    },
  };

  await assert.rejects(
    cleanupStripeConnectedAccounts(["acct_express", "acct_standard"], stripeAdapter),
    /must be disconnected from the Stripe Dashboard/,
  );

  assert.deepEqual(deletedAccountIds, []);
});

test("blocks cleanup when a known Google calendar cannot be deleted", async () => {
  const { cleanupGoogleConnections } = await import("./external-services");
  let calendarDeletionCalled = false;
  const revokedTokens: string[] = [];

  await assert.rejects(
    cleanupGoogleConnections(
      {
        googleAuthTokens: [],
        googleCalendarConnections: [
          {
            calendarId: "calendar-1",
            accessTokenEncrypted: "encrypted-expired-access",
            refreshTokenEncrypted: "encrypted-revoked-refresh",
            accessTokenExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      },
      {
        decryptSecret: (value: string) => value.replace("encrypted-", ""),
        deleteCalendar: async () => {
          calendarDeletionCalled = true;
        },
        isCredentialUnavailableError: () => true,
        now: () => new Date("2026-08-28T00:00:00.000Z").getTime(),
        refreshAccessToken: async () => {
          throw new Error("refresh token revoked");
        },
        revokeToken: async (token: string) => {
          revokedTokens.push(token);
        },
      },
    ),
    /Known Google Calendar could not be deleted/,
  );

  assert.equal(calendarDeletionCalled, false);
  assert.deepEqual(revokedTokens, []);
});

test("deletes a known Google calendar before revoking retry-safe tokens", async () => {
  const { cleanupGoogleConnections } = await import("./external-services");
  const events: string[] = [];

  await cleanupGoogleConnections(
    {
      googleAuthTokens: ["google-auth-token"],
      googleCalendarConnections: [
        {
          calendarId: "calendar-1",
          accessTokenEncrypted: "encrypted-access-token",
          refreshTokenEncrypted: "encrypted-refresh-token",
          accessTokenExpiresAt: new Date("2026-08-29T00:00:00.000Z"),
        },
      ],
    },
    {
      decryptSecret: (value: string) => value.replace("encrypted-", ""),
      deleteCalendar: async () => {
        events.push("calendar");
      },
      isCredentialUnavailableError: () => false,
      now: () => new Date("2026-08-28T00:00:00.000Z").getTime(),
      refreshAccessToken: async () => {
        throw new Error("refresh should not be needed");
      },
      // The real adapter treats Google's already-revoked response as success;
      // this seam verifies that retries still reach every revocation.
      revokeToken: async (token: string) => {
        events.push(`revoke:${token}`);
      },
    },
  );

  assert.deepEqual(events, [
    "calendar",
    "revoke:refresh-token",
    "revoke:access-token",
    "revoke:google-auth-token",
  ]);
});
