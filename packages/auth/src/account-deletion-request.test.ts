import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import { accountDeletionRequestBefore } from "./account-deletion-request";

const ORIGIN = "https://app.example.com";
const errorSchema = z.object({ code: z.string() });

const fixture = async ({
  refuse = false,
  emailConfigured = true,
}: { refuse?: boolean; emailConfigured?: boolean } = {}) => {
  const checked: string[] = [];
  const sent: string[] = [];
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "deletion-test-secret-never-used-in-production-1234567890",
    trustedOrigins: [ORIGIN],
    database: memoryAdapter(data),
    advanced: {
      database: { generateId: () => randomBytes(16).toString("base64url").slice(0, 21) },
    },
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user }) => {
          sent.push(user.email);
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await accountDeletionRequestBefore(ctx, {
          requestHook: async ({ userId }) => {
            checked.push(userId);
            if (refuse) throw new Error("Legal archive encryption is not configured");
          },
          emailConfigured,
        });
      }),
    },
  });

  const jar = new Map<string, string>();
  const request = async (path: string, body: object) => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        },
        body: JSON.stringify(body),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [nameValue] = cookie.split(";");
      const separator = nameValue.indexOf("=");
      jar.set(nameValue.slice(0, separator), nameValue.slice(separator + 1));
    }
    return response;
  };
  const signup = await request("/sign-up/email", {
    email: "owner@example.com",
    password: "Test-only-password-123!",
    name: "Owner",
  });
  assert.equal(signup.status, 200, await signup.text());
  return { checked, sent, request };
};

const errorCode = async (response: Response) => errorSchema.parse(await response.json()).code;

test("sends the confirmation e-mail when the account can be deleted", async () => {
  const { checked, sent, request } = await fixture();
  const response = await request("/delete-user", {});

  assert.equal(response.status, 200);
  assert.equal(checked.length, 1);
  assert.deepEqual(sent, ["owner@example.com"]);
});

test("answers 503 and sends nothing when the account cannot be deleted", async () => {
  const { sent, request } = await fixture({ refuse: true });
  const response = await request("/delete-user", {});

  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "ACCOUNT_DELETION_UNAVAILABLE");
  assert.deepEqual(sent, []);
});

test("answers 503 when the confirmation e-mail cannot be sent", async () => {
  const { sent, request } = await fixture({ emailConfigured: false });
  const response = await request("/delete-user", {});

  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "ACCOUNT_DELETION_EMAIL_UNAVAILABLE");
  assert.deepEqual(sent, []);
});

test("leaves the confirmation link to beforeDelete", async () => {
  const { checked, request } = await fixture({ refuse: true });
  const response = await request("/delete-user", { token: "unknown-token" });

  assert.notEqual(response.status, 503);
  assert.deepEqual(checked, []);
});
