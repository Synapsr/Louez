import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import type { DemoCue } from "./use-demo-playback";

/** Who holds the pointer, how long one loop lasts, the page it renders, what the pointer does. */
export type FeatureDemoConfig = {
  actor: "customer" | "owner";
  duration: number;
  /** A phone scene renders at 390 × 844; the marketing site frames it as a phone. */
  format?: "desktop" | "phone";
  cues: DemoCue[];
};

/** What the host hands every feature scene. A scene uses what it needs. */
export type FeatureSceneProps = {
  period: RentalPeriodValue;
  booking: DemoBooking;
  /** Opens the reservation file of the demo, like the landing journey does. */
  onOpenReservation: (
    index: number,
    booking: DemoBooking,
    period: RentalPeriodValue,
    status: ReservationStatus,
  ) => void;
};
