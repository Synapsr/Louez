"use client";

import { useState } from "react";
import { StorefrontScene } from "@/components/landing-demos/storefront-scene";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoCue } from "@/components/landing-demos/use-demo-cue";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { BookingConfirmationEmail } from "@/components/landing-demos/features/booking-confirmation-email";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";

export const BookingConfirmationScene = ({ period }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const [booking, setBooking] = useState<DemoBooking | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  useDemoCue("booking-confirmation-email", () => {
    if (booking) setShowEmail(true);
  });

  return showEmail && booking ? (
    <BookingConfirmationEmail booking={booking} locale={locale} />
  ) : (
    <StorefrontScene compact={false} period={period} onBookingChange={setBooking} />
  );
};
