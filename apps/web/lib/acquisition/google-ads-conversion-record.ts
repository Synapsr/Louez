/**
 * The Google Ads "account created" conversion, end to end (docs/analytics/lifecycle.md):
 * the sign-up queues it (`queueGoogleAdsConversion`), never calling Google itself, and
 * the cron uploads it once the click is 6 hours old (`uploadDueGoogleAdsConversions`).
 * Both do nothing while the upload is off (lib/acquisition/google-ads-config.ts).
 *
 * One row per account in `google_ads_conversions`, whose account id is the conversion's
 * transaction id: a row is claimed before it is sent, and Google counts a transaction
 * id once, so a run that dies after sending and is retried adds nothing.
 */

import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db, googleAdsConversions } from "@louez/db";

import { env } from "@/env";
import type { FirstTouch } from "@/lib/acquisition/first-touch";
import {
  type GoogleAdsConversionsConfigResult,
  readGoogleAdsConversionsConfig,
} from "@/lib/acquisition/google-ads-config";
import {
  conversionExpiresAt,
  MAX_UPLOAD_ATTEMPTS,
  pendingGoogleAdsConversion,
  uploadRetryDelayMs,
} from "@/lib/acquisition/google-ads-conversion";
import {
  createDataManagerClient,
  type DataManagerClient,
} from "@/lib/acquisition/google-data-manager";
import { log } from "@/lib/evlog";

/** How long a run holds a row before another may take it over. */
const UPLOAD_LEASE_MS = 5 * 60_000;
/** Rows uploaded per run, one request each. */
const UPLOAD_BATCH = 20;
/** How long a finished row (sent, expired, abandoned) is kept: it holds a click id. */
const FINISHED_RETENTION_MS = 30 * 86_400_000;
const FINISHED = ["sent", "expired", "abandoned"] as const;

/** The upload's configuration, from the env. */
export function googleAdsConversionsConfig(): GoogleAdsConversionsConfigResult {
  return readGoogleAdsConversionsConfig({
    GOOGLE_ADS_CONVERSIONS_ENABLED: env.GOOGLE_ADS_CONVERSIONS_ENABLED,
    GOOGLE_ADS_CUSTOMER_ID: env.GOOGLE_ADS_CUSTOMER_ID,
    GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID:
      env.GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID,
    GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: env.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  });
}

/**
 * Queues the conversion a new account owes Google Ads, when its first touch has an ad
 * click id and the upload is on; once per account. Never throws and never calls Google:
 * a sign-up does not wait for, nor fail on, its conversion.
 */
export async function queueGoogleAdsConversion(
  userId: string,
  touch: FirstTouch | null,
  options: { config?: GoogleAdsConversionsConfigResult; now?: Date } = {},
): Promise<void> {
  try {
    const config = options.config ?? googleAdsConversionsConfig();
    if (!config.enabled) return;
    const pending = pendingGoogleAdsConversion({
      userId,
      touch,
      convertedAt: options.now ?? new Date(),
    });
    if (!pending) return;
    await db
      .insert(googleAdsConversions)
      .values(pending)
      // A second call for the account keeps the first row as it is.
      .onDuplicateKeyUpdate({ set: { userId: pending.userId } });
  } catch (error) {
    log.warn(
      "google-ads",
      `conversion of user ${userId} not queued: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface GoogleAdsUploadResult {
  /** Why nothing ran, when the upload is off. */
  off?: string;
  sent: number;
  failed: number;
  /** Clicks past 90 days before their upload: Google would refuse them. */
  expired: number;
  /** Out of attempts: never sent. */
  abandoned: number;
  pruned: number;
}

/**
 * Takes a row for this run, counting the attempt: due, or left by a run whose lease
 * ended (counted too, so a row that kills its run is abandoned in the end). False if
 * another run has it.
 */
async function claim(userId: string, now: Date): Promise<boolean> {
  const [result] = await db
    .update(googleAdsConversions)
    .set({
      status: "sending",
      attempts: sql`${googleAdsConversions.attempts} + 1`,
      lockedUntil: new Date(now.getTime() + UPLOAD_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(googleAdsConversions.userId, userId),
        or(
          and(
            inArray(googleAdsConversions.status, ["pending", "failed"]),
            lte(googleAdsConversions.nextAttemptAt, now),
          ),
          and(
            eq(googleAdsConversions.status, "sending"),
            lt(googleAdsConversions.lockedUntil, now),
          ),
        ),
      ),
    );
  return result.affectedRows === 1;
}

/**
 * The cron's run: uploads the conversions whose click is old enough, one request each,
 * the oldest first. A click past 90 days expires unsent; a failed upload is retried
 * later (15 min, 30 min… at most a day apart), and abandoned after 8 runs. Finished rows
 * are deleted after 30 days. A row's failure is logged and kept on it (`last_error`):
 * the run goes on, and never throws for one row.
 */
export async function uploadDueGoogleAdsConversions(
  options: {
    config?: GoogleAdsConversionsConfigResult;
    client?: DataManagerClient;
    now?: Date;
  } = {},
): Promise<GoogleAdsUploadResult> {
  const result: GoogleAdsUploadResult = {
    sent: 0,
    failed: 0,
    expired: 0,
    abandoned: 0,
    pruned: 0,
  };
  const config = options.config ?? googleAdsConversionsConfig();
  if (!config.enabled) return { ...result, off: config.reason };
  const now = options.now ?? new Date();
  const client = options.client ?? createDataManagerClient(config.config);

  const due = await db
    .select({ userId: googleAdsConversions.userId })
    .from(googleAdsConversions)
    .where(
      or(
        and(
          inArray(googleAdsConversions.status, ["pending", "failed"]),
          lte(googleAdsConversions.nextAttemptAt, now),
        ),
        and(eq(googleAdsConversions.status, "sending"), lt(googleAdsConversions.lockedUntil, now)),
      ),
    )
    .orderBy(asc(googleAdsConversions.nextAttemptAt))
    .limit(UPLOAD_BATCH);

  for (const { userId } of due) {
    if (!(await claim(userId, now))) continue;
    const [row] = await db
      .select({
        userId: googleAdsConversions.userId,
        clickIdType: googleAdsConversions.clickIdType,
        clickId: googleAdsConversions.clickId,
        clickedAt: googleAdsConversions.clickedAt,
        convertedAt: googleAdsConversions.convertedAt,
        adUserDataConsent: googleAdsConversions.adUserDataConsent,
        adPersonalizationConsent: googleAdsConversions.adPersonalizationConsent,
        attempts: googleAdsConversions.attempts,
      })
      .from(googleAdsConversions)
      .where(eq(googleAdsConversions.userId, userId));
    if (!row) continue;

    if (now.getTime() >= conversionExpiresAt(row.clickedAt).getTime()) {
      await db
        .update(googleAdsConversions)
        .set({
          status: "expired",
          lockedUntil: null,
          lastError: "The click is more than 90 days old.",
          updatedAt: now,
        })
        .where(eq(googleAdsConversions.userId, userId));
      result.expired += 1;
      continue;
    }

    try {
      const { requestId } = await client.ingest(row);
      await db
        .update(googleAdsConversions)
        .set({
          status: "sent",
          lockedUntil: null,
          requestId,
          lastError: null,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(googleAdsConversions.userId, userId));
      result.sent += 1;
      log.info({ googleAds: { event: "conversion_uploaded", userId, requestId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const abandoned = row.attempts >= MAX_UPLOAD_ATTEMPTS;
      await db
        .update(googleAdsConversions)
        .set({
          status: abandoned ? "abandoned" : "failed",
          lockedUntil: null,
          lastError: message.slice(0, 1000),
          nextAttemptAt: new Date(now.getTime() + uploadRetryDelayMs(row.attempts)),
          updatedAt: now,
        })
        .where(eq(googleAdsConversions.userId, userId));
      if (abandoned) result.abandoned += 1;
      else result.failed += 1;
      log.warn(
        "google-ads",
        `conversion of user ${userId} ${abandoned ? "abandoned" : "not uploaded"} (attempt ${row.attempts}): ${message}`,
      );
    }
  }

  const [pruned] = await db
    .delete(googleAdsConversions)
    .where(
      and(
        inArray(googleAdsConversions.status, [...FINISHED]),
        lt(googleAdsConversions.updatedAt, new Date(now.getTime() - FINISHED_RETENTION_MS)),
      ),
    );
  result.pruned = pruned.affectedRows;
  return result;
}
