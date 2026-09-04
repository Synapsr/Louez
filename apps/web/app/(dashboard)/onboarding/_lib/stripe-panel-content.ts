import { Banknote, CalendarCheck, ShieldCheck, Zap } from "lucide-react";

/**
 * Copy shared by the two right-column variants of the Stripe step (generic and
 * reeent). Kept out of the components so the reeent panel can reuse the exact
 * same list without importing from its sibling.
 * Keys resolve under `onboarding.stripe.panel.payment`.
 */
export const PAYMENT_BENEFITS = [
  { key: "benefit1", icon: Zap },
  { key: "benefit2", icon: CalendarCheck },
  { key: "benefit3", icon: ShieldCheck },
  { key: "benefit4", icon: Banknote },
] as const;

export const PAYMENT_KYC_STEPS = ["kycStep1", "kycStep2", "kycStep3"] as const;
