import { NextResponse } from "next/server";

import { runMarketplaceDefaultPublication } from "@louez/api/services";

import { aggregateDailyAnalytics, cleanupOldAnalyticsData } from "@/lib/analytics/aggregation";
import { purgeExpiredLegalRetentionRecords } from "@/lib/account-deletion/retention-cleanup";
import { createError, useLogger, withEvlog } from "@/lib/evlog";
import { cleanExpiredCache, refreshAllStoresCache } from "@/lib/google-places/cache";
import { processVoiceNumberRenewals } from "@/lib/ai/phone/number-renewals";
import { processCalendarSyncQueue } from "@/lib/integrations/calendar/sync";
import { pollSuperPdpInvoiceEvents } from "@/lib/invoicing/superpdp-events";
import { processInvoiceTransmissionQueue } from "@/lib/invoicing/superpdp-transmission";
import { runMonthlyPayAsYouGoBilling } from "@/lib/pay-as-you-go";
import { processReminders } from "@/lib/reminders/automation";
import { processReviewRequests } from "@/lib/review-booster/automation";

import { env } from "@/env";

/**
 * Unified cron endpoint - called every minute
 *
 * Tasks and their frequencies:
 * - Review requests: every minute (checks for eligible reservations)
 * - Automatic reminders: every minute (checks for upcoming pickups/returns)
 * - Calendar sync: every minute (pushes reservation updates to calendar providers)
 * - Marketplace default publication: daily at 1:00 AM UTC when explicitly enabled
 * - Invoice transmission: every minute (converts, validates, and sends due invoices)
 * - Super PDP lifecycle polling: every minute (outgoing statuses and received invoices)
 * - Analytics aggregation: daily at 2:00 AM UTC (aggregates yesterday's data)
 * - Google Places cache refresh: daily at 3:00 AM
 * - Analytics cleanup: daily at 3:30 AM UTC (removes raw data older than 90 days)
 * - Cache cleanup: daily at 4:00 AM UTC
 * - Expired legal archive cleanup: daily at 4:30 AM UTC
 *
 * vercel.json:
 *   "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }]
 *
 * Environment variables:
 * - CRON_SECRET: Required secret to authenticate cron requests
 * - GOOGLE_PLACES_CACHE_TTL_HOURS: Cache TTL in hours (default: 24)
 */
async function handleCron(request: Request) {
  const logger = useLogger();

  // Verify cron secret. Fail closed when unset — otherwise the template
  // literal would accept a literal "Bearer undefined" header.
  const authHeader = request.headers.get("authorization");

  if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();

  const tasks: string[] = [];
  const results: Record<string, unknown> = {
    timestamp: now.toISOString(),
  };

  logger.set({
    cron: {
      minute,
      hour,
      day,
    },
  });

  try {
    // Review requests: every minute
    tasks.push("review-requests");
    results.reviewRequests = await processReviewRequests();

    // Automatic reminders: every minute
    tasks.push("reminders");
    results.reminders = await processReminders();

    // Calendar sync: every minute
    tasks.push("calendar-sync");
    results.calendarSync = await processCalendarSyncQueue();

    // Default publication is legally gated by the updated-CGV notice period and
    // remains entirely inert until production explicitly opts in.
    if (
      env.MARKETPLACE_DEFAULT_PUBLICATION_ENABLED &&
      now.getUTCHours() === 1 &&
      now.getUTCMinutes() === 0
    ) {
      tasks.push("marketplace-default-publication");
      const publicationResult = await runMarketplaceDefaultPublication({
        enabled: env.MARKETPLACE_DEFAULT_PUBLICATION_ENABLED,
        launchCohortSize: env.REEENT_LAUNCH_COHORT_SIZE,
      });
      results.marketplaceDefaultPublication = publicationResult;
      logger.set({
        marketplaceDefaultPublication: {
          candidates: publicationResult.candidates,
          published: publicationResult.published,
          errors: publicationResult.errors.length,
        },
      });
      if (publicationResult.errors.length > 0) {
        logger.error(new Error("Marketplace default publication completed with errors"), {
          errors: publicationResult.errors,
        });
      }
    }

    // Electronic invoice transmission and Super PDP event polling: every minute.
    // Both functions start with indexed/connection-scoped queries and no-op cheaply
    // when no due invoice or connected store exists.
    tasks.push("invoice-transmission");
    results.invoiceTransmission = await processInvoiceTransmissionQueue();

    tasks.push("superpdp-invoice-events");
    results.superPdpInvoiceEvents = await pollSuperPdpInvoiceEvents();

    // Analytics aggregation: daily at 2:00 AM
    if (hour === 2 && minute === 0) {
      tasks.push("analytics-aggregation");
      results.analyticsAggregation = await aggregateDailyAnalytics();
    }

    // Google Places cache refresh: daily at 3:00 AM
    if (hour === 3 && minute === 0) {
      tasks.push("google-places-refresh");
      results.googlePlacesRefresh = await refreshAllStoresCache();
    }

    // Analytics cleanup: daily at 3:30 AM (removes raw data older than 90 days)
    if (hour === 3 && minute === 30) {
      tasks.push("analytics-cleanup");
      results.analyticsCleanup = await cleanupOldAnalyticsData();
    }

    // Cache cleanup: daily at 4:00 AM
    if (hour === 4 && minute === 0) {
      tasks.push("cache-cleanup");
      const cleaned = await cleanExpiredCache();
      results.cacheCleanup = { cleaned };
    }

    if (now.getUTCHours() === 4 && now.getUTCMinutes() === 30) {
      tasks.push("legal-retention-cleanup");
      const deleted = await purgeExpiredLegalRetentionRecords(now);
      results.legalRetentionCleanup = { deleted };
    }

    // Voice-number rental renewals: daily at 8:00 AM (warn → debit → grace →
    // release; the debit retries every day during grace, so a recharge heals
    // the cycle automatically).
    if (hour === 8 && minute === 0) {
      tasks.push("voice-number-renewals");
      results.voiceNumberRenewals = await processVoiceNumberRenewals(now);
    }

    // Pay-as-you-go billing: 1st of each month at 5:00 AM UTC (bills previous
    // month). Gated in UTC to match the UTC-based billing-month math.
    if (now.getUTCDate() === 1 && now.getUTCHours() === 5 && now.getUTCMinutes() === 0) {
      tasks.push("pay-as-you-go-billing");
      results.payAsYouGoBilling = await runMonthlyPayAsYouGoBilling(now);
    }

    logger.set({
      cron: {
        tasks,
        success: true,
      },
    });

    return NextResponse.json({
      success: true,
      tasks,
      ...results,
    });
  } catch (error) {
    const cronError = error instanceof Error ? error : new Error("Unknown cron error");

    logger.error(cronError, { tasks });
    logger.set({
      cron: {
        tasks,
        success: false,
      },
    });

    throw createError({
      status: 500,
      message: "Cron execution failed",
      why: cronError.message,
      fix: "Check the Evlog request event for the failed cron task list and stack trace.",
      internal: {
        tasks,
        results,
      },
    });
  }
}

export const GET = withEvlog(handleCron);
