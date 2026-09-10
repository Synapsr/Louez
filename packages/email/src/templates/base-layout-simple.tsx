import { Body, Container, Head, Html, Link, Preview, Section, Text } from "@react-email/components";
import type { EmailLocale } from "../types";
import { shell } from "./theme";

const translations: Record<string, { sentBy: string; ignoreIfNotYou: string }> = {
  fr: {
    sentBy: "Cet email a été envoyé par Louez.",
    ignoreIfNotYou: "Si vous n'êtes pas à l'origine de cette action, vous pouvez l'ignorer.",
  },
  en: {
    sentBy: "This email was sent by Louez.",
    ignoreIfNotYou: "If you didn't initiate this action, you can ignore it.",
  },
  de: {
    sentBy: "Diese E-Mail wurde von Louez gesendet.",
    ignoreIfNotYou: "Wenn Sie diese Aktion nicht initiiert haben, können Sie sie ignorieren.",
  },
  es: {
    sentBy: "Este correo fue enviado por Louez.",
    ignoreIfNotYou: "Si no inició esta acción, puede ignorarla.",
  },
  it: {
    sentBy: "Questa email è stata inviata da Louez.",
    ignoreIfNotYou: "Se non hai avviato questa azione, puoi ignorarla.",
  },
  nl: {
    sentBy: "Deze e-mail is verzonden door Louez.",
    ignoreIfNotYou: "Als u deze actie niet heeft gestart, kunt u deze negeren.",
  },
  pl: {
    sentBy: "Ten e-mail został wysłany przez Louez.",
    ignoreIfNotYou: "Jeśli nie zainicjowałeś tej akcji, możesz ją zignorować.",
  },
  pt: {
    sentBy: "Este email foi enviado por Louez.",
    ignoreIfNotYou: "Se você não iniciou esta ação, pode ignorá-la.",
  },
};

interface BaseLayoutSimpleProps {
  preview: string;
  locale?: EmailLocale;
  children: React.ReactNode;
}

/**
 * The shell of every email Louez sends in its own name (sign-in, account):
 * the Louez wordmark centred over a narrow column, and the footer on the
 * grey band under the message.
 */
export function BaseLayoutSimple({ preview, locale = "fr", children }: BaseLayoutSimpleProps) {
  const t = translations[locale] || translations.fr;

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={shell.body}>
        <Section style={shell.page}>
          <Container style={shell.container}>
            <Section style={shell.header}>
              <Text style={shell.wordmark}>Louez</Text>
            </Section>
            <Section style={shell.content}>{children}</Section>
          </Container>
        </Section>

        <Section style={shell.footerBand}>
          <Container style={shell.container}>
            <Text style={shell.footerText}>
              {t.sentBy} {t.ignoreIfNotYou}
            </Text>
            <Text style={shell.footerText}>
              <Link href="https://louez.io" style={shell.footerLink}>
                louez.io
              </Link>
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
