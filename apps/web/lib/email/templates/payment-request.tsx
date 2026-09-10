import { Hr, Section } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  DetailRow,
  EmailHeading,
  EmailText,
  FooterNote,
  Signature,
  StoreNote,
  styles,
} from "./components";
import { getEmailTranslations, getCurrencyFormatter, type EmailLocale } from "../i18n";

interface PaymentRequestEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  amount: number;
  /**
   * `stripe`: a payment link with an amount and description, secured notice.
   * `manual`: the store owner asks for payment by hand from a reservation —
   * no payment link exists, the CTA opens the customer's reservation page.
   */
  variant?: "stripe" | "manual";
  description?: string;
  paymentUrl: string;
  customMessage?: string | null;
  locale?: EmailLocale;
  currency?: string;
}

export function PaymentRequestEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  amount,
  variant = "stripe",
  description,
  paymentUrl,
  customMessage,
  locale = "fr",
  currency = "EUR",
}: PaymentRequestEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.paymentRequest;
  const tc = t.common;
  const formatCurrency = getCurrencyFormatter(locale, currency);
  const isManual = variant === "manual";

  const body = isManual
    ? messages.manualBody.replace("{number}", reservationNumber)
    : messages.body
        .replace("{storeName}", storeName)
        .replace("{amount}", formatCurrency(amount))
        .replace("{number}", reservationNumber);

  return (
    <BaseLayout
      preview={messages.subject.replace("{number}", reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{tc.greeting.replace("{name}", customerFirstName)}</EmailText>

      <EmailText>{body}</EmailText>

      <StoreNote message={customMessage} />

      {/* Payment details */}
      <Section style={styles.card}>
        <DetailRow label={messages.reservation} value={<>#{reservationNumber}</>} />

        {!isManual && description && <DetailRow label={messages.description} value={description} />}

        <Hr style={styles.hr} />

        <DetailRow label={messages.amountDue} value={formatCurrency(amount)} emphasis="amount" />
      </Section>

      {isManual && <EmailText>{messages.payPromptly}</EmailText>}

      <CtaButton
        href={paymentUrl}
        label={
          isManual
            ? tc.viewReservation
            : messages.payNow.replace("{amount}", formatCurrency(amount))
        }
        primaryColor={primaryColor}
      />

      {isManual ? (
        <Signature text={tc.seeYouSoon.replace("{storeName}", storeName)} />
      ) : (
        <FooterNote>{messages.securePayment}</FooterNote>
      )}
    </BaseLayout>
  );
}

export default PaymentRequestEmail;
