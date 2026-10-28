import type { NextRequest } from "next/server";
import { connection } from "next/server";

import { getLocale, getTranslations } from "next-intl/server";

import { env } from "@/env";
import { answerBillingHandoff } from "@/lib/billing/handoff-handler";
import { handoffResponse } from "@/lib/billing/handoff-page";
import { getBillingSession } from "@/lib/billing/handoff-session";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

/**
 * The "Facturation" hand-off (louez-billing docs/api, README §10 steps 1 and 2):
 * lib/billing/handoff-handler.ts decides the answer, lib/billing/handoff-page.ts
 * renders it. With LOUEZ_BILLING off the proxy answers 404 first.
 *
 * Not wrapped in withEvlog, which would log every redirect to the login.
 */
export async function GET(request: NextRequest) {
  const answer = await answerBillingHandoff({
    connection,
    to: request.nextUrl.searchParams.get("to"),
    getSession: getBillingSession,
    getStore: getCurrentStore,
    isPlatformAdmin,
    getLocale,
    dashboardOrigin: env.NEXT_PUBLIC_APP_URL,
  });
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "dashboard.settings.billing.handoff" });
  return handoffResponse(answer, {
    lang: locale,
    title: t("title"),
    message: t("message"),
    continueLabel: t("continue"),
    backLabel: t("back"),
    unavailable: t("unavailable"),
  });
}
