import type { ComponentProps } from "react";
import { ReservationConfirmationEmail } from "@/lib/email/templates/reservation-confirmation";
import { getEmailTranslations } from "@/lib/email/i18n";

/** Shared by the document workshop and public demos without importing its full catalog. */
export const composeConfirmationPreview = (
  props: ComponentProps<typeof ReservationConfirmationEmail>,
) => ({
  subject: `${getEmailTranslations(props.locale).confirmReservation.subject.replace("{number}", props.reservationNumber)} - ${props.storeName}`,
  element: ReservationConfirmationEmail(props),
});
