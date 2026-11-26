import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PartnerStatement, ReservationPartner } from "@louez/api/contracts/partners";
import type { MemberRole } from "@louez/utils";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { StoreProvider } from "@/contexts/store-context";
import { partnersQueries } from "@/lib/queries/partners.queries";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/fr.json";

// The partner writes need `manage_settings`, as promo codes do: a member sees
// the statement's and the reservation's partner controls disabled, with the
// reason; the owner sees them enabled and no notice.

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

const READ_ONLY = messages.dashboard.partners.readOnly;
const RESERVATION = "pl_resa_rght_0000001";

const statement: PartnerStatement = {
  partner: {
    id: "pl_partner_000000001",
    name: "Camping Les Pins",
    code: "camping-les-pins",
    commission: { type: "percent", value: 10 },
    contact: { name: null, email: null, phone: null },
    perk: null,
    notified: false,
    archived: false,
    createdAt: new Date("2026-11-01T09:00:00Z"),
  },
  currency: "EUR",
  month: "2026-11",
  totals: { bookings: 1, due: 11, upcoming: 0, paid: 5, remaining: 6, visits: 3 },
  bookings: [
    {
      reservationId: RESERVATION,
      number: "1042",
      startDate: new Date("2026-11-10T08:00:00Z"),
      endDate: new Date("2026-11-12T17:00:00Z"),
      base: 110,
      computed: 11,
      commission: 11,
      adjustment: null,
      rule: { type: "percent", value: 10 },
      state: "due",
      origin: "link",
    },
  ],
  payouts: [{ id: "pl_payout_0000000001", amount: 5, paidAt: new Date("2026-11-20T09:00:00Z") }],
};

const reservationPartner: ReservationPartner = {
  current: {
    partnerId: statement.partner.id,
    name: statement.partner.name,
    origin: "link",
    commission: 11,
    state: "due",
  },
  currency: "EUR",
  options: [{ id: statement.partner.id, name: statement.partner.name }],
};

const analytics = {
  viewed: () => {},
  created: () => {},
  linkShared: () => {},
  monthPaid: () => {},
  statementExported: () => {},
  reservationChanged: () => {},
};

/** The `<button>` whose text is `label`, as rendered. */
const buttonOf = (html: string, label: string): string => {
  const match = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)]
    .map(([button]) => button)
    .find((button) => button.replace(/<[^>]+>/g, "").trim() === label);
  assert.ok(match, `a button "${label}"`);
  return match;
};
const isDisabled = (button: string) => /\sdisabled=""/.test(button);

describe("partner controls by role", () => {
  let views: {
    statement: typeof import("./partner-statement-card");
    reservation: typeof import("./reservation-partner-card");
  };

  before(async () => {
    views = {
      statement: await import("./partner-statement-card"),
      reservation: await import("./reservation-partner-card"),
    };
  });

  const render = (role: MemberRole, node: ReactNode) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    queryClient.setQueryData(
      partnersQueries.forReservation(RESERVATION).queryKey,
      reservationPartner,
    );
    return renderToStaticMarkup(
      <PublicEnvProvider
        config={publicEnvSchema.parse({
          NEXT_PUBLIC_APP_URL: "https://app.louez.io",
          NEXT_PUBLIC_APP_DOMAIN: "louez.io",
        })}
      >
        <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
          <QueryClientProvider client={queryClient}>
            <StoreProvider
              role={role}
              storeId="pl_store_a_000000001"
              currency="EUR"
              storeSlug="velo"
              storeName="Vélo Évasion"
            >
              {node}
            </StoreProvider>
          </QueryClientProvider>
        </NextIntlClientProvider>
      </PublicEnvProvider>,
    ).replace(/&#x27;/g, "'");
  };

  const statementCard = (role: MemberRole) =>
    render(
      role,
      <views.statement.PartnerStatementCard
        statement={statement}
        months={["2026-11"]}
        onMonthChange={() => {}}
        analytics={analytics}
      />,
    );
  const reservationCard = (role: MemberRole) =>
    render(
      role,
      <views.reservation.ReservationPartnerCard
        storeId="pl_store_a_000000001"
        reservationId={RESERVATION}
      />,
    );

  test("a member: marking paid and cancelling a payout are disabled; the export stays", () => {
    const html = statementCard("member");
    const t = messages.dashboard.partners.statement;
    assert.ok(isDisabled(buttonOf(html, t.markPaid)));
    assert.ok(isDisabled(buttonOf(html, t.cancelPayout)));
    assert.ok(!isDisabled(buttonOf(html, t.export)));
  });

  test("a member: the reservation's partner cannot be removed or changed, and says why", () => {
    const html = reservationCard("member");
    assert.match(html, new RegExp(READ_ONLY));
    const remove = html.match(
      new RegExp(
        `<button[^>]*aria-label="${messages.dashboard.partners.reservation.remove}"[^>]*>`,
      ),
    );
    assert.ok(remove && isDisabled(remove[0]));
    const select = html.match(/<button[^>]*role="combobox"[^>]*>/);
    assert.ok(select && isDisabled(select[0]));
  });

  test("the owner: every control enabled, no notice", () => {
    const t = messages.dashboard.partners.statement;
    const html = statementCard("owner");
    assert.ok(!isDisabled(buttonOf(html, t.markPaid)));
    assert.ok(!isDisabled(buttonOf(html, t.cancelPayout)));
    const card = reservationCard("owner");
    assert.doesNotMatch(card, new RegExp(READ_ONLY));
    assert.doesNotMatch(card, /\sdisabled=""/);
  });
});
