import { Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote, styles } from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

export interface DigestEntry {
  number: string;
  customerName: string;
  timeLabel: string;
}

interface ReminderDigestAdminEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  dateLabel: string;
  pickups: DigestEntry[];
  returns: DigestEntry[];
  dashboardUrl: string;
  locale?: EmailLocale;
}

export function ReminderDigestAdminEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  dateLabel,
  pickups,
  returns,
  dashboardUrl,
  locale = "fr",
}: ReminderDigestAdminEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.reminderDigestAdmin;

  const groups = [
    { key: "pickups", title: messages.pickupsTitle, entries: pickups },
    { key: "returns", title: messages.returnsTitle, entries: returns },
  ].filter((group) => group.entries.length > 0);

  return (
    <BaseLayout
      preview={messages.subject.replace("{date}", dateLabel)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace("{storeName}", storeName)}</EmailText>
      <EmailText bold>{dateLabel}</EmailText>

      {groups.map((group) => (
        <Section key={group.key} style={styles.card}>
          <Text style={{ ...styles.label, margin: "0 0 8px 0" }}>
            {group.title.replace("{count}", String(group.entries.length))}
          </Text>
          {group.entries.map((entry) => (
            <Text key={`${group.key}-${entry.number}`} style={entryRow}>
              <strong>{entry.timeLabel}</strong> · #{entry.number} · {entry.customerName}
            </Text>
          ))}
        </Section>
      ))}

      <CtaButton href={dashboardUrl} label={messages.viewCalendar} primaryColor={primaryColor} />

      <FooterNote>{messages.connectToManage}</FooterNote>
    </BaseLayout>
  );
}

const entryRow = {
  ...styles.detailLabel,
  margin: "0 0 4px 0",
};

export default ReminderDigestAdminEmail;
