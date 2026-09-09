"use server";

import { randomInt } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { customers, db, stores, verificationCodes } from "@louez/db";
import { isEmailConfigured } from "@louez/email";
import type { EmailLocale } from "@louez/email";

import { buildRateLimitKey, checkRateLimit, resetRateLimit } from "@/lib/customer-auth/rate-limit";
import {
  createCustomerSession,
  destroyCustomerSession,
  getCustomerSessionBySlug,
} from "@/lib/customer-auth/session";
import { sendVerificationCodeEmail } from "@/lib/email/send";
import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

const CODE_TTL_MS = 10 * 60 * 1000;

const emailSchema = z.email().trim().max(255);
const slugSchema = z.string().trim().min(1).max(255);

const sendCodeInputSchema = z.object({ storeSlug: slugSchema, email: emailSchema });
const verifyCodeInputSchema = z.object({
  storeSlug: slugSchema,
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});

export type SendCodeError =
  | "invalidData"
  | "emailLoginUnavailable"
  | "storeNotFound"
  | "tooManyRequests"
  | "noReservationForEmail"
  | "sendCodeError";

export type VerifyCodeError =
  | "invalidData"
  | "storeNotFound"
  | "tooManyAttempts"
  | "invalidOrExpiredCode"
  | "customerNotFound"
  | "verificationError";

export type SendCodeResult =
  | { ok: true }
  | { ok: false; error: SendCodeError; retryAfterSeconds?: number };

export type VerifyCodeResult =
  | { ok: true }
  | { ok: false; error: VerifyCodeError; retryAfterSeconds?: number };

const EMAIL_LOCALES = [
  "fr",
  "en",
  "de",
  "es",
  "it",
  "nl",
  "pl",
  "pt",
] as const satisfies readonly EmailLocale[];

const isEmailLocale = (locale: string): locale is EmailLocale =>
  EMAIL_LOCALES.some((candidate) => candidate === locale);

const toEmailLocale = (locale: string): EmailLocale => (isEmailLocale(locale) ? locale : "fr");

const generateCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

const maskEmail = (email: string): string => {
  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) return "[invalid-email]";
  return `${localPart.slice(0, 2)}***@${domainPart}`;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function requestLoginCode(input: {
  storeSlug: string;
  email: string;
}): Promise<SendCodeResult> {
  const parsed = sendCodeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidData" };
  const { storeSlug, email } = parsed.data;

  try {
    // Customer sign-in has no channel other than email: without a transport
    // the code can never arrive, so fail honestly instead of pretending.
    if (!isEmailConfigured()) {
      return { ok: false, error: "emailLoginUnavailable" };
    }

    const store = await getStoreBySlug(storeSlug);
    if (!store) return { ok: false, error: "storeNotFound" };

    const rateLimitKey = buildRateLimitKey(store.id, email);
    const decision = checkRateLimit("send", rateLimitKey);
    if (!decision.allowed) {
      return { ok: false, error: "tooManyRequests", retryAfterSeconds: decision.retryAfterSeconds };
    }

    // Login is reserved to emails that already have a customer in the store
    // (decision 8: the honest message stays).
    const customer = await db.query.customers.findFirst({
      columns: { id: true },
      where: and(eq(customers.storeId, store.id), eq(customers.email, email)),
    });
    if (!customer) return { ok: false, error: "noReservationForEmail" };

    const code = generateCode();
    const verificationCodeId = nanoid();

    // A new send invalidates every code still open for this email so only
    // the latest one can sign in.
    await db
      .update(verificationCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(verificationCodes.storeId, store.id),
          eq(verificationCodes.email, email),
          eq(verificationCodes.type, "code"),
          isNull(verificationCodes.usedAt),
        ),
      );

    await db.insert(verificationCodes).values({
      id: verificationCodeId,
      email,
      storeId: store.id,
      code,
      type: "code",
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });

    try {
      await sendVerificationCodeEmail({
        to: email,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          darkLogoUrl: store.darkLogoUrl,
          theme: store.theme,
        },
        code,
        locale: toEmailLocale(await getLocale()),
      });
    } catch (emailError) {
      log.error(
        "customer-auth",
        `verification email failed for ${maskEmail(email)} (${store.id}): ${describeError(emailError)}`,
      );
      await db.delete(verificationCodes).where(eq(verificationCodes.id, verificationCodeId));
      return { ok: false, error: "sendCodeError" };
    }

    return { ok: true };
  } catch (error) {
    log.error("customer-auth", `send code failed: ${describeError(error)}`);
    return { ok: false, error: "sendCodeError" };
  }
}

export async function verifyLoginCode(input: {
  storeSlug: string;
  email: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const parsed = verifyCodeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidOrExpiredCode" };
  const { storeSlug, email, code } = parsed.data;

  try {
    const store = await getStoreBySlug(storeSlug);
    if (!store) return { ok: false, error: "storeNotFound" };

    // 5 attempts / 15 min then a 30 min block: a 6-digit code has only a
    // million combinations.
    const rateLimitKey = buildRateLimitKey(store.id, email);
    const decision = checkRateLimit("verify", rateLimitKey);
    if (!decision.allowed) {
      return { ok: false, error: "tooManyAttempts", retryAfterSeconds: decision.retryAfterSeconds };
    }

    const verification = await db.query.verificationCodes.findFirst({
      columns: { id: true },
      where: and(
        eq(verificationCodes.storeId, store.id),
        eq(verificationCodes.email, email),
        eq(verificationCodes.type, "code"),
        eq(verificationCodes.code, code),
        gt(verificationCodes.expiresAt, new Date()),
        isNull(verificationCodes.usedAt),
      ),
    });
    if (!verification) return { ok: false, error: "invalidOrExpiredCode" };

    await db
      .update(verificationCodes)
      .set({ usedAt: new Date() })
      .where(eq(verificationCodes.id, verification.id));

    resetRateLimit("verify", rateLimitKey);

    const customer = await db.query.customers.findFirst({
      columns: { id: true },
      where: and(eq(customers.storeId, store.id), eq(customers.email, email)),
    });
    if (!customer) return { ok: false, error: "customerNotFound" };

    await createCustomerSession(customer.id);

    return { ok: true };
  } catch (error) {
    log.error("customer-auth", `verify code failed: ${describeError(error)}`);
    return { ok: false, error: "verificationError" };
  }
}

export async function logout(): Promise<{ ok: true } | { ok: false; error: "logoutError" }> {
  try {
    await destroyCustomerSession();
    return { ok: true };
  } catch (error) {
    log.error("customer-auth", `logout failed: ${describeError(error)}`);
    return { ok: false, error: "logoutError" };
  }
}

/**
 * Slug-based shim for the oRPC context and the advisor chat route. New code
 * takes the id: `getCustomerSession(storeId)` in `lib/customer-auth/session`.
 */
export async function getCustomerSession(storeSlug: string) {
  return getCustomerSessionBySlug(storeSlug);
}

/** Legacy result shape of the id-based actions, kept for the checkout "returning customer" step. */
interface LegacyCodeResult {
  success?: true;
  error?: string;
  retryAfter?: number;
}

const toLegacyResult = (result: SendCodeResult | VerifyCodeResult): LegacyCodeResult =>
  result.ok
    ? { success: true }
    : { error: `errors.${result.error}`, retryAfter: result.retryAfterSeconds };

const findStoreSlugById = async (storeId: string): Promise<string | null> => {
  if (storeId.length !== 21) return null;
  const store = await db.query.stores.findFirst({
    columns: { slug: true },
    where: eq(stores.id, storeId),
  });
  return store?.slug ?? null;
};

/**
 * @deprecated Shim over `requestLoginCode({ storeSlug, email })`: takes the
 * store id, returns `errors.`-prefixed keys. The email locale now comes
 * from the request (`getLocale()`), so the third argument is ignored.
 */
export async function sendVerificationCode(
  storeId: string,
  email: string,
  _locale?: string,
): Promise<LegacyCodeResult> {
  const storeSlug = await findStoreSlugById(storeId);
  if (!storeSlug) return { error: "errors.storeNotFound" };
  return toLegacyResult(await requestLoginCode({ storeSlug, email }));
}

/** @deprecated Shim over `verifyLoginCode({ storeSlug, email, code })`. */
export async function verifyCode(
  storeId: string,
  email: string,
  code: string,
): Promise<LegacyCodeResult> {
  const storeSlug = await findStoreSlugById(storeId);
  if (!storeSlug) return { error: "errors.storeNotFound" };
  return toLegacyResult(await verifyLoginCode({ storeSlug, email, code }));
}
