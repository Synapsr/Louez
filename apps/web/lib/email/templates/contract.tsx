import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, Signature, StoreNote } from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface ContractEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  contractUrl: string;
  /** Set while the customer has not signed: the email asks them to sign instead of downloading. */
  contractSignatureUrl?: string;
  /** Free text the store owner added when sending the contract by hand. */
  additionalMessage?: string | null;
  locale?: EmailLocale;
}

export function ContractEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeEmail,
  storePhone,
  storeAddress,
  customerFirstName,
  reservationNumber,
  contractUrl,
  contractSignatureUrl,
  additionalMessage,
  locale = "fr",
}: ContractEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.contract;
  const tc = t.common;

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
        {(contractSignatureUrl ? messages.signBody : messages.body).replace(
          "{number}",
          reservationNumber,
        )}
      </EmailText>

      <StoreNote message={additionalMessage} />

      {contractSignatureUrl ? (
        <CtaButton
          href={contractSignatureUrl}
          label={messages.signContract}
          primaryColor={primaryColor}
        />
      ) : (
        <CtaButton
          href={contractUrl}
          label={messages.downloadContract}
          primaryColor={primaryColor}
        />
      )}

      <Signature text={tc.seeYouSoon.replace("{storeName}", storeName)} />
    </BaseLayout>
  );
}

export default ContractEmail;
