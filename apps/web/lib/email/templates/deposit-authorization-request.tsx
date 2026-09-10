import { Hr, Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  DetailRow,
  EmailHeading,
  EmailText,
  FooterNote,
  StoreNote,
  styles,
} from "./components";
import { getEmailTranslations, getCurrencyFormatter, type EmailLocale } from "../i18n";

interface DepositAuthorizationRequestEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  depositAmount: number;
  authorizationUrl: string;
  customMessage?: string;
  locale?: EmailLocale;
  currency?: string;
}

export function DepositAuthorizationRequestEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  depositAmount,
  authorizationUrl,
  customMessage,
  locale = "fr",
  currency = "EUR",
}: DepositAuthorizationRequestEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.depositAuthorizationRequest;
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
          .replace("{storeName}", storeName)
          .replace("{amount}", formatCurrency(depositAmount))
          .replace("{number}", reservationNumber)}
      </EmailText>

      {/* How it works, condensed */}
      <EmailText small>
        {messages.step1} · {messages.step2}
      </EmailText>
      <EmailText small>
        {messages.step3} · {messages.step4}
      </EmailText>

      {/* Deposit details */}
      <Section style={styles.card}>
        <Text style={{ ...styles.label, margin: "0 0 12px 0" }}>{tc.summary}</Text>

        <DetailRow label={tc.reservationNumber.replace("{number}", reservationNumber)} />

        <Hr style={styles.hr} />

        <DetailRow label={tc.deposit} value={formatCurrency(depositAmount)} emphasis="amount" />
      </Section>

      {/* Custom message from store owner */}
      <StoreNote message={customMessage} />

      {/* CTA */}
      <CtaButton
        href={authorizationUrl}
        label={messages.authorizeNow}
        primaryColor={primaryColor}
      />

      <EmailText small center>
        {messages.linkFallback}
      </EmailText>
      <EmailText small center style={{ wordBreak: "break-all" }}>
        {authorizationUrl}
      </EmailText>

      <FooterNote>{messages.securePayment}</FooterNote>
    </BaseLayout>
  );
}

export default DepositAuthorizationRequestEmail;
