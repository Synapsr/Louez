import { BaseLayout } from "./base-layout";
import {
  EmailHeading,
  EmailText,
  InfoCard,
  Signature,
  StoreNote,
  resolveCustomContent,
} from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";
import type { EmailCustomContent } from "@louez/types";

interface RequestRejectedEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  reason?: string | null;
  customContent?: EmailCustomContent;
  locale?: EmailLocale;
}

export function RequestRejectedEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeEmail,
  storePhone,
  storeAddress,
  customerFirstName,
  reservationNumber,
  reason,
  customContent,
  locale = "fr",
}: RequestRejectedEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.requestRejected;
  const tc = t.common;

  const { greeting, message, signature } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${tc.regards}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

  return (
    <BaseLayout
      preview={
        customContent?.subject?.replace("{number}", reservationNumber) ||
        messages.subject.replace("{number}", reservationNumber)
      }
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{greeting}</EmailText>

      <EmailText>{messages.body.replace("{number}", reservationNumber)}</EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

      <StoreNote message={reason} />

      <EmailText>{messages.contactForAlternative}</EmailText>

      {/* Contact */}
      {(storeEmail || storePhone) && (
        <InfoCard
          label={tc.contactUs}
          value={
            <>
              {storeEmail}
              {storeEmail && storePhone && <br />}
              {storePhone}
            </>
          }
        />
      )}

      <Signature text={signature} />
    </BaseLayout>
  );
}

export default RequestRejectedEmail;
