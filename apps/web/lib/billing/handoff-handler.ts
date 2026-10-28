import { isBillingSyncEnabled } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import { buildHandoffClaims, handoffSigningKey, mintHandoffToken } from "@/lib/billing/handoff";
import { type BillingSession, getBillingHandoffAccess } from "@/lib/billing/handoff-access";
import type { BillingHandoffAnswer } from "@/lib/billing/handoff-page";
import {
  BILLING_SETTINGS_PATH,
  billingHandoffHref,
  readHandoffPage,
} from "@/lib/billing/billing-routes";
import { billingSyncConfig } from "@/lib/billing-sync/config";
import { log } from "@/lib/evlog";
import { createLoginUrl } from "@/lib/utils/util.url";

// What `GET /dashboard/billing?to=<page>` answers (louez-billing docs/api, README §10
// steps 1 and 2), apart from the Next.js calls that
// app/(dashboard)/dashboard/billing/route.ts passes in.

export type BillingHandoffRequest = {
  /**
   * `connection` from next/server. Awaited first: with `cacheComponents`, `next build`
   * would otherwise run the handler without the billing variables and ship its 404 as
   * a static answer. During a prerender it never resolves.
   */
  readonly connection: () => Promise<void>;
  /** `to` of the query string: the billing page to open. */
  readonly to: string | null;
  readonly getSession: () => Promise<BillingSession | null>;
  /** The server-side active store, never a value from the query (README §10 step 1). */
  readonly getStore: () => Promise<{ readonly id: string; readonly role: MemberRole } | null>;
  readonly isPlatformAdmin: (email: string | null) => boolean;
  /** The user's dashboard language. */
  readonly getLocale: () => Promise<string>;
  /** Louez's dashboard origin: the token's `iss` and its `return_url`. */
  readonly dashboardOrigin: string;
  readonly now?: () => Date;
};

/**
 * Mints the hand-off token for the active store's owner or a platform admin (see
 * `billingHandoffRole`) and answers the page that posts it. Only in service mode
 * (README §12). The token is never logged.
 */
export async function answerBillingHandoff(
  request: BillingHandoffRequest,
): Promise<BillingHandoffAnswer> {
  await request.connection();
  if (!isBillingSyncEnabled()) return { kind: "not_found" };

  const to = readHandoffPage(request.to);
  const session = await request.getSession();
  if (!session) return { kind: "redirect", to: createLoginUrl(billingHandoffHref(to)) };
  const store = await request.getStore();
  if (!store) return { kind: "redirect", to: "/onboarding" };

  const now = request.now?.() ?? new Date();
  const access = await getBillingHandoffAccess(store, request.isPlatformAdmin(session.email), now);
  // The settings have no billing page for anybody else.
  if (!access) return { kind: "redirect", to: "/dashboard/settings" };

  try {
    const { origin } = billingSyncConfig();
    const claims = buildHandoffClaims({
      dashboardOrigin: new URL(request.dashboardOrigin).origin,
      billingOrigin: origin,
      userId: session.userId,
      storeId: store.id,
      role: access.role,
      locale: await request.getLocale(),
      to,
      now,
    });
    const token = mintHandoffToken(claims, handoffSigningKey());
    log.info(
      "billing",
      `hand-off to the billing pages: store ${store.id}, user ${session.userId} as ${access.role}, page ${to}`,
    );
    return { kind: "page", billingOrigin: origin, token, backHref: BILLING_SETTINGS_PATH };
  } catch (error) {
    log.error(
      "billing",
      `no hand-off for store ${store.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { kind: "unavailable", backHref: BILLING_SETTINGS_PATH };
  }
}
