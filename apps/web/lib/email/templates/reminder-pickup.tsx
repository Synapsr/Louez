import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  EmailHeading,
  EmailText,
  InfoCard,
  InfoCardItem,
  Signature,
  StoreNote,
  resolveCustomContent,
} from "./components";
import { getEmailTranslations, getDateFormatPatterns, type EmailLocale } from "../i18n";
import type { EmailCustomContent } from "@louez/types";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReminderPickupEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeTimezone?: string | null;
  storeCountry?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  startDate: Date;
  reservationUrl: string;
  customContent?: EmailCustomContent;
  /** Free text the store owner added when sending this reminder by hand. */
  additionalMessage?: string | null;
  locale?: EmailLocale;
}

export function ReminderPickupEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  startDate,
  reservationUrl,
  customContent,
  additionalMessage,
  locale = "fr",
}: ReminderPickupEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.reminderPickup;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  const { greeting, message, signature } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${messages.seeTomorrow}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

  return (
    <BaseLayout
      preview={customContent?.subject || messages.subject}
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

      <StoreNote message={additionalMessage} />

      <InfoCard
        label={messages.scheduledPickup}
        value={formatEmailDateInStoreTimezone(
          startDate,
          locale,
          datePatterns.full,
          storeTimezone,
          storeCountry,
        )}
        footnote={timezoneLine}
      >
        {storeAddress && (
          <InfoCardItem
            label={tc.address}
            value={
              <>
                {storeName}
                <br />
                {storeAddress}
              </>
            }
          />
        )}
      </InfoCard>

      <EmailText small>
        {messages.dontForget} {messages.bringId} · {messages.bringConfirmation}
      </EmailText>

      <CtaButton href={reservationUrl} label={tc.viewReservation} primaryColor={primaryColor} />

      <Signature text={signature} />
    </BaseLayout>
  );
}

export default ReminderPickupEmail;
