import { createHmac } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { nanoid } from "nanoid";

import { accounts, db } from "@louez/db";

import { env } from "./env";
import { authInstance } from "./index";

/**
 * The throwaway accounts of demo stores (apps/web lib/demo). Each gets an
 * e-mail + password credential whose password nobody ever sees: it is derived
 * from the account id and AUTH_SECRET, so it is never stored and the server
 * can sign the visitor in whenever the store is claimed. Better Auth signs in
 * with it as it would any e-mail + password: the session, its cookies and their
 * signature are Better Auth's own.
 */

const demoPassword = (userId: string): string =>
  createHmac("sha256", env.AUTH_SECRET).update(`louez-demo-account:${userId}`).digest("base64url");

/** Gives a demo account its credential. Done when the store is made, ahead of any visitor. */
export async function createDemoAccountCredential(userId: string): Promise<void> {
  const now = new Date();
  await db.insert(accounts).values({
    id: nanoid(),
    userId,
    providerId: "credential",
    accountId: userId,
    password: await hashPassword(demoPassword(userId)),
    createdAt: now,
    updatedAt: now,
  });
}

/** Signs a visitor into a demo account. Returns the headers that set the session cookies. */
export async function signInDemoAccount(input: {
  userId: string;
  email: string;
  headers: Headers;
}): Promise<Headers> {
  const response = await authInstance.api.signInEmail({
    body: { email: input.email, password: demoPassword(input.userId), rememberMe: false },
    headers: input.headers,
    asResponse: true,
  });
  if (!response.ok) throw new Error(`Demo sign-in refused (${response.status})`);
  return response.headers;
}
