import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";
import {
  readPartnerBookingNotice,
  readPartnerPayoutNotice,
  readPartnerStatementNotice,
} from "@louez/api/services/partner-space";
import { isEmailConfigured } from "@louez/email";
import { formatCurrency } from "@louez/utils";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { apiUrls } from "@/lib/api/urls";
import { getLocaleFromCountry, type EmailLocale } from "@/lib/email/i18n";
import { sendPartnerNotificationEmail } from "@/lib/email/send";
import { partnerSpaceUrl } from "@/lib/partners/partner-space-path";

// The senders of a partner's e-mails (Liens partenaires, packages/api
// services/partner-space.ts). Each reads the partner and what it is about when
// it goes out: a partner who turned the e-mails off, has no address, or a
// booking or payment undone since, gets nothing (`skipped`). An instance
// without e-mail skips them too: the store owes its partner no e-mail.

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface PartnerNotificationDeps {
  isEmailConfigured: typeof isEmailConfigured;
  readPartnerBookingNotice: typeof readPartnerBookingNotice;
  readPartnerPayoutNotice: typeof readPartnerPayoutNotice;
  readPartnerStatementNotice: typeof readPartnerStatementNotice;
  sendPartnerNotificationEmail: typeof sendPartnerNotificationEmail;
}

const defaultDeps: PartnerNotificationDeps = {
  isEmailConfigured,
  readPartnerBookingNotice,
  readPartnerPayoutNotice,
  readPartnerStatementNotice,
  sendPartnerNotificationEmail,
};

const NO_EMAIL = { skipped: "email_not_configured" } as const;

/** A month, `YYYY-MM`, as words: "novembre 2026". */
export const formatPartnerMonth = (month: string, locale: EmailLocale): string => {
  const [year, index] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, index - 1, 15)));
};

export function createPartnerNotificationEffectSenders(
  overrides: Partial<PartnerNotificationDeps> = {},
): Pick<
  ApiEffectSenders,
  "partner.bookingEmail" | "partner.payoutEmail" | "partner.statementEmail"
> {
  const deps: PartnerNotificationDeps = { ...defaultDeps, ...overrides };

  const send = async (
    context: EffectSendContext,
    notice: {
      to: string;
      store: { name: string; logoUrl: string | null; country: string | null };
      partnerName: string;
      token: string;
    },
    notification: Parameters<typeof sendPartnerNotificationEmail>[0]["notification"],
    locale: EmailLocale,
  ) => {
    await context.assertClaim();
    await deps.sendPartnerNotificationEmail({
      to: notice.to,
      storeName: notice.store.name,
      storeLogoUrl: notice.store.logoUrl,
      partnerName: notice.partnerName,
      notification,
      spaceUrl: partnerSpaceUrl(apiUrls.dashboard("/"), notice.token),
      locale,
    });
  };

  return {
    "partner.bookingEmail": (
      payload: ApiEffectPayloads["partner.bookingEmail"],
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        if (!deps.isEmailConfigured()) return NO_EMAIL;
        const notice = await deps.readPartnerBookingNotice(
          payload.partnerId,
          payload.reservationId,
        );
        if ("skipped" in notice) return notice;
        const locale = getLocaleFromCountry(notice.store.country);
        await send(
          context,
          notice,
          {
            kind: "booking",
            amount: formatCurrency(notice.booking.commission, notice.store.currency),
            endDate: new Intl.DateTimeFormat(locale, {
              day: "numeric",
              month: "long",
              timeZone: notice.store.timezone,
            }).format(notice.booking.endDate),
          },
          locale,
        );
      }),
    "partner.payoutEmail": (
      payload: ApiEffectPayloads["partner.payoutEmail"],
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        if (!deps.isEmailConfigured()) return NO_EMAIL;
        const notice = await deps.readPartnerPayoutNotice(payload.partnerId, payload.payoutId);
        if ("skipped" in notice) return notice;
        const locale = getLocaleFromCountry(notice.store.country);
        await send(
          context,
          notice,
          {
            kind: "payout",
            amount: formatCurrency(notice.amount, notice.store.currency),
            month: formatPartnerMonth(notice.month, locale),
          },
          locale,
        );
      }),
    "partner.statementEmail": (
      payload: ApiEffectPayloads["partner.statementEmail"],
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        if (!deps.isEmailConfigured()) return NO_EMAIL;
        const notice = await deps.readPartnerStatementNotice(payload.partnerId, payload.month);
        if ("skipped" in notice) return notice;
        const locale = getLocaleFromCountry(notice.store.country);
        const money = (amount: number) => formatCurrency(amount, notice.store.currency);
        await send(
          context,
          notice,
          {
            kind: "statement",
            month: formatPartnerMonth(notice.month, locale),
            bookings: notice.totals.bookings,
            due: money(notice.totals.due),
            paid: money(notice.totals.paid),
            remaining: money(Math.max(0, notice.totals.remaining)),
          },
          locale,
        );
      }),
  };
}
