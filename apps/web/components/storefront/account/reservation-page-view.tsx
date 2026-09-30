import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { BackLink } from "@/components/storefront/ui/back-link";
import type { ReservationStatus } from "@/components/storefront/account/reservation-status.constants";
import { ReservationOutcomeBanner } from "@/components/storefront/account/reservation-outcome-banner";
import { ReservationStatusCard } from "@/components/storefront/account/reservation-status-card";
import { ReservationActions } from "@/components/storefront/account/reservation-actions";
import { ReservationFulfillmentSummary } from "@/components/storefront/account/reservation-fulfillment-summary";
import { ReservationTimeline } from "@/components/storefront/account/reservation-timeline";
import { ReservationItemsCard } from "@/components/storefront/account/reservation-items-card";
import { ReservationUpdatesCard } from "@/components/storefront/account/reservation-updates-card";
import { ReservationDepositCard } from "@/components/storefront/account/reservation-deposit-card";
import { ReturnDateRequestCard } from "@/components/storefront/account/return-date-request-card";
import { ReservationPaymentsCard } from "@/components/storefront/account/reservation-payments-card";
import { ReservationInspectionsCard } from "@/components/storefront/account/reservation-inspections-card";
import { ReservationInvoicesCard } from "@/components/storefront/account/reservation-invoices-card";
import { StoreContactCard } from "@/components/storefront/account/store-contact-card";
import { AccountCard } from "@/components/storefront/account/account-card";
import { ReservationStatusBadge } from "@/components/storefront/account/reservation-status-badge";
import { AddToCalendarButton } from "@/components/storefront/account/add-to-calendar-button";

export interface ReservationPageViewProps {
  number: string;
  status: ReservationStatus;
  cancelledRequest: boolean;
  periodLabel: string;
  calendarLinks: ComponentProps<typeof AddToCalendarButton>["links"];
  reviewPrompt?: ReactNode;
  readOnly?: boolean;
  onAcceptQuote?: () => void;
  outcome: ComponentProps<typeof ReservationOutcomeBanner>;
  statusCard: ComponentProps<typeof ReservationStatusCard>;
  actions: ComponentProps<typeof ReservationActions>;
  fulfillment: ComponentProps<typeof ReservationFulfillmentSummary>;
  timeline: ComponentProps<typeof ReservationTimeline>;
  items: ComponentProps<typeof ReservationItemsCard>;
  updates: ComponentProps<typeof ReservationUpdatesCard>;
  deposit: ComponentProps<typeof ReservationDepositCard> | null;
  returnDateRequest: ComponentProps<typeof ReturnDateRequestCard>;
  payments: ComponentProps<typeof ReservationPaymentsCard>;
  inspections: ComponentProps<typeof ReservationInspectionsCard>;
  invoices: ComponentProps<typeof ReservationInvoicesCard>;
  contact: ComponentProps<typeof StoreContactCard>;
}

/** Shared customer detail layout; queries and page effects stay in the route. */
export const ReservationPageView = ({
  number,
  status,
  cancelledRequest,
  periodLabel,
  calendarLinks,
  reviewPrompt,
  readOnly = false,
  onAcceptQuote,
  outcome,
  statusCard,
  actions,
  fulfillment,
  timeline,
  items,
  updates,
  deposit,
  returnDateRequest,
  payments,
  inspections,
  invoices,
  contact,
}: ReservationPageViewProps) => {
  const t = useTranslations("storefront.account");
  return (
    <StorefrontSection contentClassName="flex max-w-6xl flex-col gap-4 sm:gap-6">
      <div>
        <BackLink href={readOnly ? "#" : "/account"}>{t("backToAccount")}</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {t(status === "pending" || cancelledRequest ? "requestNumber" : "reservationNumber", {
              number: number,
            })}
          </h1>
          <ReservationStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{periodLabel}</p>
      </div>

      <ReservationOutcomeBanner {...outcome} />

      <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <ReservationStatusCard {...statusCard} />

        <ReservationActions {...actions} readOnly={readOnly} onAcceptQuote={onAcceptQuote} />
      </div>

      {reviewPrompt}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountCard
            title={t("timeline.title")}
            aside={
              ["confirmed", "ongoing", "completed"].includes(status) ? (
                <AddToCalendarButton links={calendarLinks} readOnly={readOnly} />
              ) : null
            }
          >
            <ReservationFulfillmentSummary {...fulfillment} />
            <ReservationTimeline {...timeline} />
          </AccountCard>

          <ReservationItemsCard {...items} />

          <ReservationUpdatesCard {...updates} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          {deposit ? <ReservationDepositCard {...deposit} /> : null}
          <ReturnDateRequestCard {...returnDateRequest} readOnly={readOnly} />
          <ReservationPaymentsCard {...payments} />

          <ReservationInspectionsCard {...inspections} />

          <ReservationInvoicesCard {...invoices} />

          <StoreContactCard {...contact} autoFocus={!readOnly} />
        </aside>
      </div>
    </StorefrontSection>
  );
};
