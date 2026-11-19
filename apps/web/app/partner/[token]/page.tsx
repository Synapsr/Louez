import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getFormatter, getTranslations } from "next-intl/server";

import { partnerMonthSchema } from "@louez/api/contracts/partners";
import { getPartnerSpace } from "@louez/api/services/partner-space";
import { Badge, Card, CardPanel, Logo } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import { PartnerSpaceHeader } from "@/components/partners/partner-space-header";
import { PartnerSpaceLink } from "@/components/partners/partner-space-link";
import { PartnerSpaceNotifications } from "@/components/partners/partner-space-notifications";
import { PartnerSpaceSection } from "@/components/partners/partner-space-section";
import { partnerLinkUrl } from "@/lib/partners/util.partner-link";
import { getStorefrontUrl } from "@/lib/storefront-url";
import {
  DEFAULT_STORE_THEME,
  buildStoreThemeStyle,
  getStoreThemeClassName,
} from "@/lib/theme/util.store-theme";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerSpace");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const STATE_BADGE = { upcoming: "pending", due: "success", cancelled: "tertiary" } as const;

/**
 * A partner's own space, without an account (Liens partenaires): where it
 * stands with the store (to receive, coming, received), its recent activity,
 * its link and poster, a month's detail, and the e-mails it wants. Found by
 * the secret the store sends; nothing on it names a customer.
 */
export default async function PartnerSpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const month = partnerMonthSchema.safeParse(query.month);
  const space = await getPartnerSpace(token, month.success ? month.data : undefined);
  if (!space) notFound();

  const t = await getTranslations("partnerSpace");
  const format = await getFormatter();
  const money = (amount: number) => formatCurrency(amount, space.currency);
  const monthLabel = (value: string) => {
    const [year, index] = value.split("-").map(Number);
    return format.dateTime(new Date(year, index - 1, 15), { month: "long", year: "numeric" });
  };
  const day = (date: Date) => format.dateTime(date, { day: "numeric", month: "long" });
  const rule =
    space.partner.rule.type === "percent"
      ? t("rule.percent", { value: String(space.partner.rule.value) })
      : t("rule.fixed", { value: money(space.partner.rule.value) });
  const storeUrl = getStorefrontUrl(space.store.slug, "/");
  const link = partnerLinkUrl(storeUrl, space.partner.code);
  // The store's own look, as on its storefront: its colour, light or dark.
  const theme = {
    mode: space.store.theme.mode,
    primaryColor: space.store.theme.primaryColor ?? DEFAULT_STORE_THEME.primaryColor,
  };
  const themeStyle = buildStoreThemeStyle(theme);
  const logoUrl =
    theme.mode === "dark" && space.store.darkLogoUrl
      ? space.store.darkLogoUrl
      : space.store.logoUrl;
  const tiles = [
    { key: "toReceive", amount: space.overview.toReceive, strong: true },
    { key: "upcoming", amount: space.overview.upcoming, strong: false },
    { key: "received", amount: space.overview.received, strong: false },
  ] as const;

  return (
    <div
      className={cn(
        "bg-background text-foreground min-h-screen",
        getStoreThemeClassName(theme.mode),
      )}
    >
      {themeStyle ? <style>{themeStyle}</style> : null}
      <PartnerSpaceHeader
        storeName={space.store.name}
        storeUrl={storeUrl}
        logoUrl={logoUrl}
        heroImage={space.store.heroImage}
        eyebrow={t("eyebrow", { store: space.store.name })}
        title={t("title", { partner: space.partner.name })}
        intro={`${t("howItWorks", { rule, days: space.attributionDays })}${
          space.partner.perkCode ? ` ${t("perk", { code: space.partner.perkCode })}` : ""
        }`}
        visitStore={t("visitStore")}
      />

      <main className="mx-auto max-w-2xl space-y-8 px-4 pt-8 pb-12">
        {space.partner.archived && (
          <Card>
            <CardPanel className="p-4 text-sm">{t("archived")}</CardPanel>
          </Card>
        )}

        <div className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <Card
              key={tile.key}
              className={cn(
                "shadow-sm",
                tile.strong && "bg-primary text-primary-foreground border-primary",
              )}
            >
              <CardPanel className="space-y-1 p-3 sm:p-4">
                <p className={cn("text-xs", tile.strong ? "opacity-85" : "text-muted-foreground")}>
                  {t(`overview.${tile.key}.label`)}
                </p>
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    tile.strong ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
                  )}
                >
                  {money(tile.amount)}
                </p>
                <p
                  className={cn(
                    "hidden text-xs sm:block",
                    tile.strong ? "opacity-85" : "text-muted-foreground",
                  )}
                >
                  {t(`overview.${tile.key}.hint`)}
                </p>
              </CardPanel>
            </Card>
          ))}
        </div>

        <PartnerSpaceSection title={t("activity.title")}>
          {space.activity.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("activity.empty")}</p>
          ) : (
            <ul className="divide-y">
              {space.activity.map((entry, index) => (
                <li
                  key={`${entry.kind}-${entry.at.getTime()}-${index}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {entry.kind === "booking"
                        ? t("activity.booking")
                        : t("activity.payout", { month: monthLabel(entry.month) })}
                    </span>
                    <span className="text-muted-foreground block">
                      {entry.kind === "booking"
                        ? t("activity.bookingWhen", {
                            date: day(entry.at),
                            end: day(entry.endDate),
                          })
                        : t("activity.payoutWhen", { date: day(entry.at) })}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        entry.kind === "booking" &&
                          entry.state === "cancelled" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {entry.kind === "booking" ? money(entry.commission) : money(entry.amount)}
                    </span>
                    {entry.kind === "booking" ? (
                      <Badge variant={STATE_BADGE[entry.state]}>{t(`states.${entry.state}`)}</Badge>
                    ) : (
                      <Badge variant="success">{t("states.paid")}</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PartnerSpaceSection>

        {!space.partner.archived && (
          <PartnerSpaceSection title={t("link.title")} description={t("link.description")}>
            <PartnerSpaceLink
              storeName={space.store.name}
              link={link}
              code={space.partner.code}
              partnerName={space.partner.name}
              accentColor={theme.primaryColor}
              logoUrl={space.store.logoUrl}
            />
          </PartnerSpaceSection>
        )}

        <PartnerSpaceSection title={t("months.title")}>
          <div className="space-y-4">
            <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label={t("months.title")}>
              {space.months.map((value) => (
                <Link
                  key={value}
                  href={`?month=${value}`}
                  scroll={false}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap first-letter:uppercase",
                    value === space.month
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted",
                  )}
                  aria-current={value === space.month ? "page" : undefined}
                >
                  {monthLabel(value)}
                </Link>
              ))}
            </nav>
            <dl className="grid grid-cols-3 gap-3">
              {(["due", "paid", "remaining"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-muted-foreground text-xs">{t(`months.${key}`)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{money(space.totals[key])}</dd>
                </div>
              ))}
            </dl>
            {space.totals.upcoming > 0 && (
              <p className="text-muted-foreground text-sm">
                {t("months.upcoming", { amount: money(space.totals.upcoming) })}
              </p>
            )}
            {space.bookings.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("months.empty")}</p>
            ) : (
              <ul className="divide-y border-t">
                {space.bookings.map((booking, index) => (
                  // No id here on purpose: nothing on this page names a reservation.
                  <li
                    key={`${booking.endDate.getTime()}-${index}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <span>{t("months.rentalEnds", { date: day(booking.endDate) })}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          booking.state === "cancelled" && "text-muted-foreground line-through",
                        )}
                      >
                        {money(booking.commission)}
                      </span>
                      <Badge variant={STATE_BADGE[booking.state]}>
                        {t(`states.${booking.state}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PartnerSpaceSection>

        <PartnerSpaceSection
          title={t("notifications.title")}
          description={t("notifications.description")}
        >
          <PartnerSpaceNotifications token={token} initial={space.notifications} />
        </PartnerSpaceSection>

        <footer className="text-muted-foreground space-y-4 text-xs">
          <div className="space-y-1">
            <p>{t("rules")}</p>
            <p>{t("paidBy", { store: space.store.name })}</p>
          </div>
          <p className="text-foreground">
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener"
              className="font-medium hover:underline"
            >
              {space.store.name}
            </a>
            {space.store.address && ` · ${space.store.address}`}
          </p>
          <p className="flex items-center gap-1.5">
            {t("poweredBy")}
            <Logo className="h-3.5 w-auto" />
          </p>
        </footer>
      </main>
    </div>
  );
}
