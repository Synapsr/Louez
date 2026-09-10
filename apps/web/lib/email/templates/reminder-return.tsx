import { BaseLayout } from "./base-layout";
import {
  EmailHeading,
  EmailText,
  InfoCard,
  InfoCardItem,
  Signature,
  StoreNote,
  resolveCustomContent,
} from "./components";
import {
  getEmailTranslator,
  getEmailTranslations,
  getDateFormatPatterns,
  type EmailLocale,
} from "../i18n";
import type { EmailCustomContent } from "@louez/types";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReminderReturnEmailProps {
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
  endDate: Date;
  customContent?: EmailCustomContent;
  /** Free text the store owner added when sending this reminder by hand. */
  additionalMessage?: string | null;
  locale?: EmailLocale;
}

export function ReminderReturnEmail({
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
  endDate,
  customContent,
  additionalMessage,
  locale = "fr",
}: ReminderReturnEmailProps) {
  const t = getEmailTranslations(locale);
  const translate = getEmailTranslator(locale);
  const messages = t.reminderReturn;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const formattedEndDate = formatEmailDateInStoreTimezone(
    endDate,
    locale,
    datePatterns.full,
    storeTimezone,
    storeCountry,
  );
  const timezoneLabel = getStoreTimezoneLabel(endDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  const { greeting, message, signature } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${messages.thanks}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

  return (
    <BaseLayout
      preview={
        customContent?.subject || translate("reminderReturn.subject", { date: formattedEndDate })
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

      <EmailText>
        {translate("reminderReturn.body", {
          number: reservationNumber,
          date: formattedEndDate,
        })}
      </EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

      <StoreNote message={additionalMessage} />

      <InfoCard label={messages.scheduledReturn} value={formattedEndDate} footnote={timezoneLine}>
        {storeAddress && (
          <InfoCardItem
            label={tc.returnAddress}
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

      <EmailText>{messages.returnInfo}</EmailText>

      <Signature text={signature} />
    </BaseLayout>
  );
}

export default ReminderReturnEmail;
