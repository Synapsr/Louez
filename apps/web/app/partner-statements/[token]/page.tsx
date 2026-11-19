import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getFormatter, getTranslations } from "next-intl/server";

import { partnerMonthSchema } from "@louez/api/contracts/partners";
import { getPublicPartnerStatement } from "@louez/api/services/partners";
import { Badge, Card, CardPanel } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerStatement");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const STATE_BADGE = { upcoming: "pending", due: "success", cancelled: "tertiary" } as const;

/**
 * A partner's statement, read-only and without an account: what the store's
 * link brought it, month by month (docs/product/liens-partenaires.md). Found
 * by the secret the store sends; it shows nothing about the customers.
 */
export default async function PartnerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const month = partnerMonthSchema.safeParse(query.month);
  const statement = await getPublicPartnerStatement(token, month.success ? month.data : undefined);
  if (!statement) notFound();

  const t = await getTranslations("partnerStatement");
  const format = await getFormatter();
  const money = (amount: number) => formatCurrency(amount, statement.currency);
  const monthLabel = (value: string) => {
    const [year, index] = value.split("-").map(Number);
    return format.dateTime(new Date(year, index - 1, 1), { month: "long", year: "numeric" });
  };
  const { totals } = statement;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">{statement.storeName}</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("title", { partner: statement.partnerName })}
        </h1>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label={t("months")}>
        {statement.months.map((value) => (
          <Link
            key={value}
            href={`?month=${value}`}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap first-letter:uppercase",
              value === statement.month
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted",
            )}
            aria-current={value === statement.month ? "page" : undefined}
          >
            {monthLabel(value)}
          </Link>
        ))}
      </nav>

      <Card>
        <CardPanel className="p-0">
          <dl className="grid grid-cols-3 gap-3 border-b px-4 py-4">
            <div>
              <dt className="text-muted-foreground text-xs">{t("due")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(totals.due)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t("paid")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(totals.paid)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t("remaining")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(totals.remaining)}</dd>
            </div>
          </dl>
          {totals.upcoming > 0 && (
            <p className="text-muted-foreground border-b px-4 py-3 text-sm">
              {t("upcoming", { amount: money(totals.upcoming) })}
            </p>
          )}
          {statement.bookings.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {statement.bookings.map((booking, index) => (
                // No id here on purpose: nothing on this page names a reservation.
                <li
                  key={`${booking.endDate.getTime()}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="text-sm">
                    {t("rentalEnded", {
                      date: format.dateTime(booking.endDate, { day: "numeric", month: "long" }),
                    })}
                  </span>
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
        </CardPanel>
      </Card>

      <div className="text-muted-foreground space-y-1 text-xs">
        <p>{t("rules")}</p>
        <p>{t("paidBy", { store: statement.storeName })}</p>
      </div>
    </div>
  );
}
