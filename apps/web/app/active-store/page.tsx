import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { dashboardPath, DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

import { ActiveStoreSwitchCard } from "@/components/dashboard/active-store-switch-card";

import { getStoreSwitchState } from "@/lib/store-context";
import { ACTIVE_STORE_NEXT_PARAM, dashboardReturnPath } from "@/lib/util.active-store-link";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activeStoreSwitch");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Where a dashboard link naming another store of the user lands
 * (app/api/active-store): it asks before the dashboard changes store, as the
 * link may come from any site. Reaching it otherwise (the same store, one the
 * user may not open) sends the user on to the dashboard path.
 */
export default async function ActiveStorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const storeId = first(params[DASHBOARD_STORE_PARAM]).trim().slice(0, 64);
  const next = dashboardReturnPath(first(params[ACTIVE_STORE_NEXT_PARAM]) || null);

  const state = await getStoreSwitchState(storeId);
  if (state.kind === "signed-out") {
    redirect(createLoginUrl(dashboardPath({ id: storeId }, next), env.NEXT_PUBLIC_APP_URL));
  }
  if (state.kind === "stay") redirect(next);

  return <ActiveStoreSwitchCard target={state.target} current={state.current} next={next} />;
}
