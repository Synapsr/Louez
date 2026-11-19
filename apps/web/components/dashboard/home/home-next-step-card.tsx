import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import type { VisibilityView } from "@louez/api/contracts/visibility";

import { LaunchSeatsOffer } from "@/components/dashboard/launch-seats-offer";
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
  /** The reeent launch seats the store can still claim; null when not offered. */
  launchOfferSeats: number | null;
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
    {step === "cohort" && launchOfferSeats !== null && (
      <LaunchSeatsOffer remaining={launchOfferSeats} asHomeInvitation />
    )}
  </>
);
