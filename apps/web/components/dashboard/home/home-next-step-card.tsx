import type { DismissibleNoticeId } from "@louez/api/contracts/dismissed-notices";
import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import type { VisibilityView } from "@louez/api/contracts/visibility";

import { MarketplaceCohortNotice } from "@/components/dashboard/marketplace-cohort-notice";
import { TestReservationHomeCard } from "@/components/dashboard/test-reservation/test-reservation-home-card";
import { VisibilityHomeCard } from "@/components/dashboard/visibility/visibility-home-card";
import type { McpEndpoint } from "@/lib/agent-connections/mcp-endpoint";

import { AgentAssistantNotice } from "./agent-assistant-notice";
import { FirstProductCard } from "./first-product-card";
import { HomeNextStepViewed } from "./home-next-step-viewed";
import { ReeentStripeSetupCard } from "./reeent-stripe-setup-card";
import type { HomeNextStep } from "./util.next-step";

export interface HomeNextStepCardProps {
  step: Exclude<HomeNextStep, "planOffer">;
  storeId: string;
  hasStripeAccount: boolean;
  /** Where an assistant connects, while the home still offers one; null otherwise. */
  assistant: McpEndpoint | null;
  testReservation: GetTestReservationOutput | null;
  visibility: VisibilityView | null;
  /** The reeent launch seats the visibility card mentions; null when not offered. */
  launchOfferSeats: number | null;
  cohort: {
    lifetimeFeeWaiverAt: string | null;
    cohortRank: number | null;
    remaining: number;
  };
  dismissedNoticeIds: DismissibleNoticeId[];
}

/** One of the home's next step cards, counted as shown. */
export const HomeNextStepCard = ({
  step,
  storeId,
  hasStripeAccount,
  assistant,
  testReservation,
  visibility,
  launchOfferSeats,
  cohort,
  dismissedNoticeIds,
}: HomeNextStepCardProps) => (
  <>
    <HomeNextStepViewed step={step} />
    {step === "reeentStripe" && <ReeentStripeSetupCard hasStripeAccount={hasStripeAccount} />}
    {step === "firstProduct" && <FirstProductCard assistant={assistant} />}
    {step === "testReservation" && testReservation && (
      <TestReservationHomeCard initialState={testReservation} />
    )}
    {step === "visibility" && visibility && (
      <VisibilityHomeCard storeId={storeId} view={visibility} launchOfferSeats={launchOfferSeats} />
    )}
    {step === "agentAssistant" && assistant && <AgentAssistantNotice {...assistant} />}
    {step === "cohort" && (
      <MarketplaceCohortNotice {...cohort} dismissedNoticeIds={dismissedNoticeIds} />
    )}
  </>
);
