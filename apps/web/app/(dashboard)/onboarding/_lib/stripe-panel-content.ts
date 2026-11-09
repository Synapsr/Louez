import { Banknote, CalendarCheck, ShieldCheck, Zap } from "lucide-react";

import {
  AnalyticsGlassIcon,
  BillingGlassIcon,
  CustomersGlassIcon,
  ReservationsGlassIcon,
} from "@louez/ui/icons/glass";

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

/**
 * The same four benefits as cards in the generic panel, each with its Lagon
 * glass icon. Keys resolve under `onboarding.stripe.panel.payment`.
 */
export const PAYMENT_BENEFIT_CARDS = [
  { key: "benefit1", icon: BillingGlassIcon },
  { key: "benefit2", icon: ReservationsGlassIcon },
  { key: "benefit3", icon: CustomersGlassIcon },
  { key: "benefit4", icon: AnalyticsGlassIcon },
] as const;
