import { Suspense } from "react";

import { HomeNextStepCard, type HomeNextStepCardProps } from "./home-next-step-card";
import { PlanOfferSection } from "./plan-offer-section";
import type { HomeNextStep as HomeNextStepKind } from "./util.next-step";

export interface HomeNextStepProps extends Omit<HomeNextStepCardProps, "step"> {
  /** The card to show and, for the plan offer, the one in its place without an offer. */
  choice: { step: HomeNextStepKind | null; fallback: HomeNextStepKind | null };
}

/**
 * The home's one next step card (docs/product/accueil-prochaine-etape.md), as
 * `pickHomeNextStep` chose it. The plan offer streams in from the billing
 * service; without an offer its fallback takes the place.
 */
export const HomeNextStep = ({ choice, ...props }: HomeNextStepProps) => {
  const { step, fallback } = choice;
  if (step === "planOffer") {
    return (
      <Suspense fallback={null}>
        <PlanOfferSection
          fallback={
            fallback && fallback !== "planOffer" && <HomeNextStepCard step={fallback} {...props} />
          }
        />
      </Suspense>
    );
  }
  return step && <HomeNextStepCard step={step} {...props} />;
};
