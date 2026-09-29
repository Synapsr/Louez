import { Heading, Section, Text } from "@react-email/components";
import { BaseLayoutSimple } from "./base-layout-simple";
import { styles } from "./theme";
import type { EmailLocale } from "../types";

/** What the code unlocks: a session, or the right to choose a new password. */
export type OtpEmailPurpose = "sign-in" | "forget-password";

interface OtpTranslation {
  subject: string;
  title: string;
  body: string;
  expiry: string;
}

const translations: Record<
  EmailLocale,
  { greeting: string } & Record<OtpEmailPurpose, OtpTranslation>
> = {
  fr: {
    greeting: "Bonjour,",
    "sign-in": {
      subject: "Votre code de connexion Louez",
      title: "Votre code de connexion",
      body: "Voici votre code pour vous connecter à Louez. Il est valable 5 minutes.",
      expiry: "Si vous n'avez pas demandé ce code, vous pouvez ignorer cet email.",
    },
    "forget-password": {
      subject: "Votre code pour réinitialiser votre mot de passe Louez",
      title: "Réinitialiser votre mot de passe",
      body: "Voici votre code pour choisir un nouveau mot de passe Louez. Il est valable 5 minutes.",
      expiry:
        "Si vous n'avez pas demandé ce code, ignorez cet email : votre mot de passe reste inchangé.",
    },
  },
  en: {
    greeting: "Hello,",
    "sign-in": {
      subject: "Your Louez sign-in code",
      title: "Your sign-in code",
      body: "Here is your code to sign in to Louez. It is valid for 5 minutes.",
      expiry: "If you didn't request this code, you can ignore this email.",
    },
    "forget-password": {
      subject: "Your Louez password reset code",
      title: "Reset your password",
      body: "Here is your code to choose a new Louez password. It is valid for 5 minutes.",
      expiry: "If you didn't request this code, ignore this email: your password stays unchanged.",
    },
  },
  de: {
    greeting: "Hallo,",
    "sign-in": {
      subject: "Ihr Louez-Anmeldecode",
      title: "Ihr Anmeldecode",
      body: "Hier ist Ihr Code für die Anmeldung bei Louez. Er ist 5 Minuten gültig.",
      expiry:
        "Wenn Sie diesen Code nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    },
    "forget-password": {
      subject: "Ihr Code zum Zurücksetzen Ihres Louez-Passworts",
      title: "Passwort zurücksetzen",
      body: "Hier ist Ihr Code, um ein neues Louez-Passwort festzulegen. Er ist 5 Minuten gültig.",
      expiry:
        "Wenn Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.",
    },
  },
  es: {
    greeting: "Hola,",
    "sign-in": {
      subject: "Tu código de inicio de sesión de Louez",
      title: "Tu código de inicio de sesión",
      body: "Este es tu código para iniciar sesión en Louez. Es válido durante 5 minutos.",
      expiry: "Si no has solicitado este código, puedes ignorar este correo.",
    },
    "forget-password": {
      subject: "Tu código para restablecer tu contraseña de Louez",
      title: "Restablecer tu contraseña",
      body: "Este es tu código para elegir una nueva contraseña de Louez. Es válido durante 5 minutos.",
      expiry: "Si no has solicitado este código, ignora este correo: tu contraseña no cambiará.",
    },
  },
  it: {
    greeting: "Ciao,",
    "sign-in": {
      subject: "Il tuo codice di accesso a Louez",
      title: "Il tuo codice di accesso",
      body: "Ecco il codice per accedere a Louez. È valido per 5 minuti.",
      expiry: "Se non hai richiesto questo codice, puoi ignorare questa email.",
    },
    "forget-password": {
      subject: "Il tuo codice per reimpostare la password di Louez",
      title: "Reimposta la tua password",
      body: "Ecco il codice per scegliere una nuova password di Louez. È valido per 5 minuti.",
      expiry:
        "Se non hai richiesto questo codice, ignora questa email: la tua password resterà invariata.",
    },
  },
  nl: {
    greeting: "Hallo,",
    "sign-in": {
      subject: "Uw Louez-inlogcode",
      title: "Uw inlogcode",
      body: "Dit is uw code om in te loggen bij Louez. De code is 5 minuten geldig.",
      expiry: "Hebt u deze code niet aangevraagd, dan kunt u deze e-mail negeren.",
    },
    "forget-password": {
      subject: "Uw code om uw Louez-wachtwoord opnieuw in te stellen",
      title: "Uw wachtwoord opnieuw instellen",
      body: "Dit is uw code om een nieuw Louez-wachtwoord te kiezen. De code is 5 minuten geldig.",
      expiry:
        "Hebt u deze code niet aangevraagd, negeer dan deze e-mail. Uw wachtwoord blijft ongewijzigd.",
    },
  },
  pl: {
    greeting: "Dzień dobry,",
    "sign-in": {
      subject: "Twój kod logowania do Louez",
      title: "Twój kod logowania",
      body: "Oto kod do zalogowania się w Louez. Jest ważny przez 5 minut.",
      expiry: "Jeśli to nie Ty prosiłeś o ten kod, zignoruj tę wiadomość.",
    },
    "forget-password": {
      subject: "Twój kod do zresetowania hasła Louez",
      title: "Zresetuj hasło",
      body: "Oto kod, który pozwoli Ci ustawić nowe hasło do Louez. Jest ważny przez 5 minut.",
      expiry:
        "Jeśli to nie Ty prosiłeś o ten kod, zignoruj tę wiadomość. Hasło pozostanie bez zmian.",
    },
  },
  pt: {
    greeting: "Olá,",
    "sign-in": {
      subject: "O seu código de início de sessão Louez",
      title: "O seu código de início de sessão",
      body: "Aqui está o seu código para iniciar sessão no Louez. É válido durante 5 minutos.",
      expiry: "Se não pediu este código, pode ignorar este email.",
    },
    "forget-password": {
      subject: "O seu código para repor a palavra-passe Louez",
      title: "Repor a sua palavra-passe",
      body: "Aqui está o seu código para escolher uma nova palavra-passe Louez. É válido durante 5 minutos.",
      expiry:
        "Se não pediu este código, ignore este email: a sua palavra-passe permanece inalterada.",
    },
  },
};

interface OTPEmailProps {
  otp: string;
  locale?: EmailLocale;
  purpose?: OtpEmailPurpose;
}

export const getOtpEmailSubject = (locale: EmailLocale, purpose: OtpEmailPurpose): string =>
  translations[locale][purpose].subject;

export function OTPEmail({ otp, locale = "fr", purpose = "sign-in" }: OTPEmailProps) {
  const { greeting } = translations[locale];
  const t = translations[locale][purpose];

  return (
    <BaseLayoutSimple preview={t.subject} locale={locale}>
      <Heading style={styles.title}>{t.title}</Heading>

      <Text style={styles.paragraph}>{greeting}</Text>

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
