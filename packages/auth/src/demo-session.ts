import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { nanoid } from "nanoid";

import { accounts, db } from "@louez/db";

import { authInstance } from "./index";

/**
 * Signs a visitor into the throwaway account of a demo store (apps/web
 * lib/demo). The account gets a random password nobody ever sees, and Better
 * Auth signs in with it as it would any e-mail + password: the session, its
 * cookies and their signature are Better Auth's own. Returns the headers that
 * set the session cookies, for the caller's response.
 */
export async function signInDemoAccount(input: {
  userId: string;
  email: string;
  headers: Headers;
}): Promise<Headers> {
  const password = randomBytes(24).toString("base64url");
  const now = new Date();
  await db.insert(accounts).values({
    id: nanoid(),
    userId: input.userId,
    providerId: "credential",
    accountId: input.userId,
    password: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  const response = await authInstance.api.signInEmail({
    body: { email: input.email, password, rememberMe: false },
    headers: input.headers,
    asResponse: true,
  });
  if (!response.ok) throw new Error(`Demo sign-in refused (${response.status})`);
  return response.headers;
}
