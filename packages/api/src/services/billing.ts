import { db, readReservationGateSince } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import { billingErrors, type BillingStatus } from "../contracts/billing";
import { dashboardPageLinks, type DashboardLinkStore } from "../platform/links";
import type { ApiPorts } from "../platform/ports";

/**
 * What Louez bills a store, read-only, from the billing code (`ports.billing`)
 * and the card gate (`readReservationGateSince`, the inbox's reading), and
 * whether the caller may start the billing card's handoff.
 */

const NOBODY: Omit<BillingStatus, "gate" | "cardSetup" | "links"> = {
  billing: "none",
  mode: null,
  plan: null,
  offer: null,
  notice: null,
  payAsYouGo: null,
  card: null,
  invoices: [],
  service: null,
};

/** The page that shows it: the billing settings when the service bills, the plans otherwise. */
const pageOf = (billing: BillingStatus["billing"]) =>
  billing === "service"
    ? ("/dashboard/settings/billing" as const)
    : billing === "legacy"
      ? ("/dashboard/settings/subscription" as const)
      : ("/dashboard/settings" as const);

export async function getBillingStatus(input: {
  storeId: string;
  role: MemberRole;
  store: DashboardLinkStore;
  ports: Pick<ApiPorts, "billing" | "urls">;
  /** The language of the billing service's words; English when it has no other. */
  locale: string;
  now?: Date;
}): Promise<BillingStatus> {
  const now = input.now ?? new Date();
  const [read, gate] = await Promise.all([
    input.ports.billing
      ? input.ports.billing.status({ storeId: input.storeId, locale: input.locale, now })
      : Promise.resolve({ ...NOBODY, cardSetupOpen: false, cardSetupBlocked: null }),
    readReservationGateSince(db, input.storeId, now),
  ]);
  const { cardSetupOpen, cardSetupBlocked, ...status } = read;
  const reason =
    status.billing !== "service"
      ? ("not_billed_by_service" as const)
      : input.role !== "owner"
        ? ("owner_only" as const)
        : cardSetupOpen
          ? null
          : cardSetupBlocked;
  return {
    ...status,
    gate: gate.accepts
      ? { acceptsReservations: true, reason: null, since: null }
      : { acceptsReservations: false, reason: gate.reason, since: gate.since },
    cardSetup: { available: reason === null, reason },
    links: dashboardPageLinks(input.ports.urls, input.store, pageOf(status.billing)),
  };
}

/**
 * Who may hand the billing card's step to the user: the store's owner, on a
 * store the billing service bills (the dashboard's billing pages, owner only).
 */
export async function assertCardSetupAllowed(input: {
  storeId: string;
  role: MemberRole;
  ports: Pick<ApiPorts, "billing">;
  now?: Date;
}): Promise<void> {
  const billed =
    (await input.ports.billing?.billedByService(input.storeId, input.now ?? new Date())) ?? false;
  if (!billed) throw billingErrors.cardSetupUnavailable("not_billed_by_service");
  if (input.role !== "owner") throw billingErrors.cardSetupUnavailable("owner_only");
}
