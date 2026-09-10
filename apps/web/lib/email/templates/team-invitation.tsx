import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote } from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface TeamInvitationEmailProps {
  storeName: string;
  storeLogoUrl?: string | null;
  primaryColor?: string;
  inviterName: string;
  invitationUrl: string;
  locale?: EmailLocale;
}

export function TeamInvitationEmail({
  storeName,
  storeLogoUrl,
  primaryColor,
  inviterName,
  invitationUrl,
  locale = "fr",
}: TeamInvitationEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.teamInvitation;

  return (
    <BaseLayout
      preview={messages.subject
        .replace("{inviterName}", inviterName)
        .replace("{storeName}", storeName)}
      storeName={storeName}
      logoUrl={storeLogoUrl}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.greeting}</EmailText>

      <EmailText>
        <strong>{inviterName}</strong>{" "}
        {messages.body.replace("{inviterName}", "").replace("{storeName}", storeName).trim()}
      </EmailText>

      <EmailText>{messages.accessDescription}</EmailText>

      <CtaButton href={invitationUrl} label={messages.acceptButton} primaryColor={primaryColor} />

      <FooterNote>{messages.expiry}</FooterNote>
    </BaseLayout>
  );
}

export default TeamInvitationEmail;
