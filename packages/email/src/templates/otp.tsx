import { Heading, Section, Text } from "@react-email/components";
import { BaseLayoutSimple } from "./base-layout-simple";
import { styles } from "./theme";
import type { EmailLocale } from "../types";

const translations: Record<
  string,
  { subject: string; title: string; greeting: string; body: string; expiry: string }
> = {
  fr: {
    subject: "Code de connexion",
    title: "Votre code de connexion",
    greeting: "Bonjour,",
    body: "Voici votre code pour vous connecter à Louez. Il est valable 5 minutes.",
    expiry: "Si vous n'avez pas demandé ce code, vous pouvez ignorer cet email.",
  },
  en: {
    subject: "Sign-in code",
    title: "Your sign-in code",
    greeting: "Hello,",
    body: "Here is your code to sign in to Louez. It is valid for 5 minutes.",
    expiry: "If you didn't request this code, you can ignore this email.",
  },
};

interface OTPEmailProps {
  otp: string;
  locale?: EmailLocale;
}

export function OTPEmail({ otp, locale = "fr" }: OTPEmailProps) {
  const t = translations[locale] || translations.fr;

  return (
    <BaseLayoutSimple preview={t.subject} locale={locale}>
      <Heading style={styles.title}>{t.title}</Heading>

      <Text style={styles.paragraph}>{t.greeting}</Text>

      <Text style={styles.paragraph}>{t.body}</Text>

      <Section style={codeSection}>
        <Text style={styles.code}>{otp}</Text>
      </Section>

      <Text style={{ ...styles.small, margin: "0" }}>{t.expiry}</Text>
    </BaseLayoutSimple>
  );
}

const codeSection = {
  margin: "28px 0",
};

export default OTPEmail;
