import { BaseLayout } from "./base-layout";
import { CtaButton, EmailText, Signature } from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface CustomMessageEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  /** The store owner's words — here the message IS the email. */
  message: string;
  reservationUrl: string;
  locale?: EmailLocale;
}

export function CustomMessageEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeEmail,
  storePhone,
  storeAddress,
  customerFirstName,
  reservationNumber,
  message,
  reservationUrl,
  locale = "fr",
}: CustomMessageEmailProps) {
  const t = getEmailTranslations(locale);
  const tc = t.common;

  return (
    <BaseLayout
      preview={t.customMessage.subject.replace("{number}", reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailText>{tc.greeting.replace("{name}", customerFirstName)}</EmailText>

      <EmailText style={{ whiteSpace: "pre-line" as const }}>{message}</EmailText>

      <CtaButton href={reservationUrl} label={tc.viewReservation} primaryColor={primaryColor} />

      <Signature text={tc.seeYouSoon.replace("{storeName}", storeName)} />
    </BaseLayout>
  );
}

export default CustomMessageEmail;
