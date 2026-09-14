import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote } from "./components";
import { getEmailTranslations, getCurrencyFormatter, type EmailLocale } from "../i18n";

interface PaymentFailedEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  paymentAmount: number;
  errorMessage?: string | null;
  paymentUrl?: string;
  locale?: EmailLocale;
  currency?: string;
}

export function PaymentFailedEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  paymentAmount,
  errorMessage,
  paymentUrl,
  locale = "fr",
  currency = "EUR",
}: PaymentFailedEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.paymentFailed;
  const tc = t.common;

  const formatCurrency = getCurrencyFormatter(locale, currency);

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

      <EmailText>
        {messages.body
          .replace("{number}", reservationNumber)
          .replace("{amount}", formatCurrency(paymentAmount))}
      </EmailText>

      {/* Error info if provided */}
      {errorMessage && <EmailText muted>{errorMessage}</EmailText>}

      <EmailText>{messages.whatToDo}</EmailText>

      <EmailText small>
        {messages.tip1} · {messages.tip2} · {messages.tip3}
      </EmailText>

      {/* CTA */}
      {paymentUrl && (
        <CtaButton href={paymentUrl} label={messages.retryPayment} primaryColor={primaryColor} />
      )}

      <FooterNote>{messages.contactSupport}</FooterNote>
    </BaseLayout>
  );
}

export default PaymentFailedEmail;
