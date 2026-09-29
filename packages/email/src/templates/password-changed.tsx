import { supplementalMessages } from "../messages";
import { Button, Heading, Section, Text } from "@react-email/components";

import type { EmailLocale } from "../types";
import { BaseLayoutSimple } from "./base-layout-simple";
import { styles } from "./theme";

/**
 * What happened to the account's password. `reset` is the forgot-password
 * flow: proven by an e-mail code, it may have created the first password or
 * replaced an existing one, so it gets its own wording.
 */
export type PasswordChangedEvent = "added" | "changed" | "reset" | "removed";

interface PasswordChangedEventTranslation {
  subject: string;
  title: string;
  body: string;
}

interface PasswordChangedTranslation {
  greeting: string;
  events: Record<PasswordChangedEvent, PasswordChangedEventTranslation>;
  ownAction: string;
  notYou: string;
  button: string;
  signInNote: string;
}

const translations: Record<EmailLocale, PasswordChangedTranslation> = {
  fr: {
    greeting: "Bonjour,",
    events: {
      added: {
        subject: "Un mot de passe vient d’être ajouté à votre compte Louez",
        title: "Mot de passe ajouté",
        body: "Un mot de passe vient d’être ajouté à votre compte Louez. Vous pouvez désormais vous connecter avec votre e-mail et ce mot de passe, en plus du code reçu par e-mail. Vos autres appareils ont été déconnectés.",
      },
      changed: {
        subject: "Le mot de passe de votre compte Louez vient d’être modifié",
        title: "Mot de passe modifié",
        body: "Le mot de passe de votre compte Louez vient d’être modifié. Vos autres appareils ont été déconnectés.",
      },
      reset: {
        subject: "Le mot de passe de votre compte Louez vient d’être réinitialisé",
        title: "Mot de passe réinitialisé",
        body: "Le mot de passe de votre compte Louez vient d’être réinitialisé à l’aide d’un code reçu par e-mail. Tous vos appareils ont été déconnectés.",
      },
      removed: {
        subject: "Le mot de passe de votre compte Louez vient d’être retiré",
        title: "Mot de passe retiré",
        body: "Le mot de passe de votre compte Louez vient d’être retiré. Vous continuez à vous connecter avec un code reçu par e-mail.",
      },
    },
    ownAction: "Si vous êtes à l’origine de cette action, vous n’avez rien à faire.",
    notYou:
      "Ce n’était pas vous ? Sécurisez votre compte : le mot de passe sera retiré et tous les appareils seront déconnectés.",
    button: "Ce n’était pas moi",
    signInNote:
      "Pour confirmer, il vous sera demandé de vous connecter avec un code reçu par e-mail.",
  },
  en: {
    greeting: "Hello,",
    events: {
      added: {
        subject: "A password was just added to your Louez account",
        title: "Password added",
        body: "A password was just added to your Louez account. You can now sign in with your email and this password, as well as with a code sent by email. Your other devices have been signed out.",
      },
      changed: {
        subject: "The password of your Louez account was just changed",
        title: "Password changed",
        body: "The password of your Louez account was just changed. Your other devices have been signed out.",
      },
      reset: {
        subject: "The password of your Louez account was just reset",
        title: "Password reset",
        body: "The password of your Louez account was just reset using a code sent by email. All your devices have been signed out.",
      },
      removed: {
        subject: "The password of your Louez account was just removed",
        title: "Password removed",
        body: "The password of your Louez account was just removed. You can still sign in with a code sent by email.",
      },
    },
    ownAction: "If this was you, there is nothing to do.",
    notYou:
      "Wasn’t you? Secure your account: the password will be removed and every device will be signed out.",
    button: "This wasn’t me",
    signInNote: "To confirm, you will be asked to sign in with a code sent by email.",
  },
  de: {
    greeting: "Hallo,",
    events: {
      added: {
        subject: "Ihrem Louez-Konto wurde soeben ein Passwort hinzugefügt",
        title: "Passwort hinzugefügt",
        body: "Ihrem Louez-Konto wurde soeben ein Passwort hinzugefügt. Sie können sich jetzt mit Ihrer E-Mail-Adresse und diesem Passwort anmelden – zusätzlich zum Code per E-Mail. Ihre anderen Geräte wurden abgemeldet.",
      },
      changed: {
        subject: "Das Passwort Ihres Louez-Kontos wurde soeben geändert",
        title: "Passwort geändert",
        body: "Das Passwort Ihres Louez-Kontos wurde soeben geändert. Ihre anderen Geräte wurden abgemeldet.",
      },
      reset: {
        subject: "Das Passwort Ihres Louez-Kontos wurde soeben zurückgesetzt",
        title: "Passwort zurückgesetzt",
        body: "Das Passwort Ihres Louez-Kontos wurde soeben mit einem per E-Mail gesendeten Code zurückgesetzt. Alle Ihre Geräte wurden abgemeldet.",
      },
      removed: {
        subject: "Das Passwort Ihres Louez-Kontos wurde soeben entfernt",
        title: "Passwort entfernt",
        body: "Das Passwort Ihres Louez-Kontos wurde soeben entfernt. Sie melden sich weiterhin mit einem Code per E-Mail an.",
      },
    },
    ownAction: "Wenn Sie das waren, müssen Sie nichts weiter tun.",
    notYou:
      "Das waren nicht Sie? Sichern Sie Ihr Konto: Das Passwort wird entfernt und alle Geräte werden abgemeldet.",
    button: "Das war ich nicht",
    signInNote: "Zur Bestätigung werden Sie gebeten, sich mit einem Code per E-Mail anzumelden.",
  },
  es: {
    greeting: "Hola,",
    events: {
      added: {
        subject: "Se acaba de añadir una contraseña a tu cuenta Louez",
        title: "Contraseña añadida",
        body: "Se acaba de añadir una contraseña a tu cuenta Louez. Ahora puedes iniciar sesión con tu correo y esta contraseña, además del código recibido por correo. Se ha cerrado la sesión en tus otros dispositivos.",
      },
      changed: {
        subject: "La contraseña de tu cuenta Louez acaba de cambiarse",
        title: "Contraseña cambiada",
        body: "La contraseña de tu cuenta Louez acaba de cambiarse. Se ha cerrado la sesión en tus otros dispositivos.",
      },
      reset: {
        subject: "La contraseña de tu cuenta Louez acaba de restablecerse",
        title: "Contraseña restablecida",
        body: "La contraseña de tu cuenta Louez acaba de restablecerse con un código recibido por correo. Se ha cerrado la sesión en todos tus dispositivos.",
      },
      removed: {
        subject: "La contraseña de tu cuenta Louez acaba de eliminarse",
        title: "Contraseña eliminada",
        body: "La contraseña de tu cuenta Louez acaba de eliminarse. Sigues iniciando sesión con un código recibido por correo.",
      },
    },
    ownAction: "Si has sido tú, no tienes que hacer nada.",
    notYou:
      "¿No has sido tú? Protege tu cuenta: se eliminará la contraseña y se cerrará la sesión en todos los dispositivos.",
    button: "No he sido yo",
    signInNote: "Para confirmarlo, se te pedirá iniciar sesión con un código recibido por correo.",
  },
  it: {
    greeting: "Ciao,",
    events: {
      added: {
        subject: "È appena stata aggiunta una password al tuo account Louez",
        title: "Password aggiunta",
        body: "È appena stata aggiunta una password al tuo account Louez. Ora puoi accedere con la tua email e questa password, oltre che con il codice ricevuto via email. Gli altri tuoi dispositivi sono stati disconnessi.",
      },
      changed: {
        subject: "La password del tuo account Louez è appena stata modificata",
        title: "Password modificata",
        body: "La password del tuo account Louez è appena stata modificata. Gli altri tuoi dispositivi sono stati disconnessi.",
      },
      reset: {
        subject: "La password del tuo account Louez è appena stata reimpostata",
        title: "Password reimpostata",
        body: "La password del tuo account Louez è appena stata reimpostata con un codice ricevuto via email. Tutti i tuoi dispositivi sono stati disconnessi.",
      },
      removed: {
        subject: "La password del tuo account Louez è appena stata rimossa",
        title: "Password rimossa",
        body: "La password del tuo account Louez è appena stata rimossa. Continui ad accedere con un codice ricevuto via email.",
      },
    },
    ownAction: "Se sei stato tu, non devi fare nulla.",
    notYou:
      "Non sei stato tu? Metti al sicuro il tuo account: la password verrà rimossa e tutti i dispositivi saranno disconnessi.",
    button: "Non sono stato io",
    signInNote: "Per confermare ti verrà chiesto di accedere con un codice ricevuto via email.",
  },
  nl: {
    greeting: "Hallo,",
    events: {
      added: {
        subject: "Er is zojuist een wachtwoord toegevoegd aan uw Louez-account",
        title: "Wachtwoord toegevoegd",
        body: "Er is zojuist een wachtwoord toegevoegd aan uw Louez-account. U kunt nu inloggen met uw e-mailadres en dit wachtwoord, naast de code per e-mail. Uw andere apparaten zijn uitgelogd.",
      },
      changed: {
        subject: "Het wachtwoord van uw Louez-account is zojuist gewijzigd",
        title: "Wachtwoord gewijzigd",
        body: "Het wachtwoord van uw Louez-account is zojuist gewijzigd. Uw andere apparaten zijn uitgelogd.",
      },
      reset: {
        subject: "Het wachtwoord van uw Louez-account is zojuist opnieuw ingesteld",
        title: "Wachtwoord opnieuw ingesteld",
        body: "Het wachtwoord van uw Louez-account is zojuist opnieuw ingesteld met een code per e-mail. Al uw apparaten zijn uitgelogd.",
      },
      removed: {
        subject: "Het wachtwoord van uw Louez-account is zojuist verwijderd",
        title: "Wachtwoord verwijderd",
        body: "Het wachtwoord van uw Louez-account is zojuist verwijderd. U blijft inloggen met een code per e-mail.",
      },
    },
    ownAction: "Was u dit zelf, dan hoeft u niets te doen.",
    notYou:
      "Was u dit niet? Beveilig uw account: het wachtwoord wordt verwijderd en alle apparaten worden uitgelogd.",
    button: "Dit was ik niet",
    signInNote: "Ter bevestiging wordt u gevraagd in te loggen met een code per e-mail.",
  },
  pl: {
    greeting: "Dzień dobry,",
    events: {
      added: {
        subject: "Do Twojego konta Louez właśnie dodano hasło",
        title: "Hasło dodane",
        body: "Do Twojego konta Louez właśnie dodano hasło. Możesz teraz logować się adresem e-mail i tym hasłem, a także kodem wysyłanym e-mailem. Pozostałe urządzenia zostały wylogowane.",
      },
      changed: {
        subject: "Hasło do Twojego konta Louez właśnie zostało zmienione",
        title: "Hasło zmienione",
        body: "Hasło do Twojego konta Louez właśnie zostało zmienione. Pozostałe urządzenia zostały wylogowane.",
      },
      reset: {
        subject: "Hasło do Twojego konta Louez właśnie zostało zresetowane",
        title: "Hasło zresetowane",
        body: "Hasło do Twojego konta Louez właśnie zostało zresetowane za pomocą kodu wysłanego e-mailem. Wszystkie urządzenia zostały wylogowane.",
      },
      removed: {
        subject: "Hasło do Twojego konta Louez właśnie zostało usunięte",
        title: "Hasło usunięte",
        body: "Hasło do Twojego konta Louez właśnie zostało usunięte. Nadal logujesz się kodem wysyłanym e-mailem.",
      },
    },
    ownAction: "Jeśli to Ty, nie musisz nic robić.",
    notYou:
      "To nie Ty? Zabezpiecz konto: hasło zostanie usunięte, a wszystkie urządzenia zostaną wylogowane.",
    button: "To nie ja",
    signInNote: "Aby to potwierdzić, poprosimy o zalogowanie się kodem wysłanym e-mailem.",
  },
  pt: {
    greeting: "Olá,",
    events: {
      added: {
        subject: "Foi adicionada uma palavra-passe à sua conta Louez",
        title: "Palavra-passe adicionada",
        body: "Acaba de ser adicionada uma palavra-passe à sua conta Louez. Já pode iniciar sessão com o seu email e esta palavra-passe, além do código recebido por email. Os seus outros dispositivos foram desligados.",
      },
      changed: {
        subject: "A palavra-passe da sua conta Louez foi alterada",
        title: "Palavra-passe alterada",
        body: "A palavra-passe da sua conta Louez acaba de ser alterada. Os seus outros dispositivos foram desligados.",
      },
      reset: {
        subject: "A palavra-passe da sua conta Louez foi reposta",
        title: "Palavra-passe reposta",
        body: "A palavra-passe da sua conta Louez acaba de ser reposta com um código recebido por email. Todos os seus dispositivos foram desligados.",
      },
      removed: {
        subject: "A palavra-passe da sua conta Louez foi removida",
        title: "Palavra-passe removida",
        body: "A palavra-passe da sua conta Louez acaba de ser removida. Continua a iniciar sessão com um código recebido por email.",
      },
    },
    ownAction: "Se foi você, não precisa de fazer nada.",
    notYou:
      "Não foi você? Proteja a sua conta: a palavra-passe será removida e todos os dispositivos serão desligados.",
    button: "Não fui eu",
    signInNote:
      "Para confirmar, ser-lhe-á pedido que inicie sessão com um código recebido por email.",
  },
  zh: {
    greeting: supplementalMessages.zh.password_changed_translations_greeting,
    events: {
      added: {
        subject: supplementalMessages.zh.password_changed_translations_events_added_subject,
        title: supplementalMessages.zh.password_changed_translations_events_added_title,
        body: supplementalMessages.zh.password_changed_translations_events_added_body,
      },
      changed: {
        subject: supplementalMessages.zh.password_changed_translations_events_changed_subject,
        title: supplementalMessages.zh.password_changed_translations_events_changed_title,
        body: supplementalMessages.zh.password_changed_translations_events_changed_body,
      },
      reset: {
        subject: supplementalMessages.zh.password_changed_translations_events_reset_subject,
        title: supplementalMessages.zh.password_changed_translations_events_reset_title,
        body: supplementalMessages.zh.password_changed_translations_events_reset_body,
      },
      removed: {
        subject: supplementalMessages.zh.password_changed_translations_events_removed_subject,
        title: supplementalMessages.zh.password_changed_translations_events_removed_title,
        body: supplementalMessages.zh.password_changed_translations_events_removed_body,
      },
    },
    ownAction: supplementalMessages.zh.password_changed_translations_ownAction,
    notYou: supplementalMessages.zh.password_changed_translations_notYou,
    button: supplementalMessages.zh.password_changed_translations_button,
    signInNote: supplementalMessages.zh.password_changed_translations_signInNote,
  },
  ja: {
    greeting: supplementalMessages.ja.password_changed_translations_greeting,
    events: {
      added: {
        subject: supplementalMessages.ja.password_changed_translations_events_added_subject,
        title: supplementalMessages.ja.password_changed_translations_events_added_title,
        body: supplementalMessages.ja.password_changed_translations_events_added_body,
      },
      changed: {
        subject: supplementalMessages.ja.password_changed_translations_events_changed_subject,
        title: supplementalMessages.ja.password_changed_translations_events_changed_title,
        body: supplementalMessages.ja.password_changed_translations_events_changed_body,
      },
      reset: {
        subject: supplementalMessages.ja.password_changed_translations_events_reset_subject,
        title: supplementalMessages.ja.password_changed_translations_events_reset_title,
        body: supplementalMessages.ja.password_changed_translations_events_reset_body,
      },
      removed: {
        subject: supplementalMessages.ja.password_changed_translations_events_removed_subject,
        title: supplementalMessages.ja.password_changed_translations_events_removed_title,
        body: supplementalMessages.ja.password_changed_translations_events_removed_body,
      },
    },
    ownAction: supplementalMessages.ja.password_changed_translations_ownAction,
    notYou: supplementalMessages.ja.password_changed_translations_notYou,
    button: supplementalMessages.ja.password_changed_translations_button,
    signInNote: supplementalMessages.ja.password_changed_translations_signInNote,
  },
  ru: {
    greeting: supplementalMessages.ru.password_changed_translations_greeting,
    events: {
      added: {
        subject: supplementalMessages.ru.password_changed_translations_events_added_subject,
        title: supplementalMessages.ru.password_changed_translations_events_added_title,
        body: supplementalMessages.ru.password_changed_translations_events_added_body,
      },
      changed: {
        subject: supplementalMessages.ru.password_changed_translations_events_changed_subject,
        title: supplementalMessages.ru.password_changed_translations_events_changed_title,
        body: supplementalMessages.ru.password_changed_translations_events_changed_body,
      },
      reset: {
        subject: supplementalMessages.ru.password_changed_translations_events_reset_subject,
        title: supplementalMessages.ru.password_changed_translations_events_reset_title,
        body: supplementalMessages.ru.password_changed_translations_events_reset_body,
      },
      removed: {
        subject: supplementalMessages.ru.password_changed_translations_events_removed_subject,
        title: supplementalMessages.ru.password_changed_translations_events_removed_title,
        body: supplementalMessages.ru.password_changed_translations_events_removed_body,
      },
    },
    ownAction: supplementalMessages.ru.password_changed_translations_ownAction,
    notYou: supplementalMessages.ru.password_changed_translations_notYou,
    button: supplementalMessages.ru.password_changed_translations_button,
    signInNote: supplementalMessages.ru.password_changed_translations_signInNote,
  },
  id: {
    greeting: supplementalMessages.id.password_changed_translations_greeting,
    events: {
      added: {
        subject: supplementalMessages.id.password_changed_translations_events_added_subject,
        title: supplementalMessages.id.password_changed_translations_events_added_title,
        body: supplementalMessages.id.password_changed_translations_events_added_body,
      },
      changed: {
        subject: supplementalMessages.id.password_changed_translations_events_changed_subject,
        title: supplementalMessages.id.password_changed_translations_events_changed_title,
        body: supplementalMessages.id.password_changed_translations_events_changed_body,
      },
      reset: {
        subject: supplementalMessages.id.password_changed_translations_events_reset_subject,
        title: supplementalMessages.id.password_changed_translations_events_reset_title,
        body: supplementalMessages.id.password_changed_translations_events_reset_body,
      },
      removed: {
        subject: supplementalMessages.id.password_changed_translations_events_removed_subject,
        title: supplementalMessages.id.password_changed_translations_events_removed_title,
        body: supplementalMessages.id.password_changed_translations_events_removed_body,
      },
    },
    ownAction: supplementalMessages.id.password_changed_translations_ownAction,
    notYou: supplementalMessages.id.password_changed_translations_notYou,
    button: supplementalMessages.id.password_changed_translations_button,
    signInNote: supplementalMessages.id.password_changed_translations_signInNote,
  },
  ko: {
    greeting: supplementalMessages.ko.password_changed_translations_greeting,
    events: {
      added: {
        subject: supplementalMessages.ko.password_changed_translations_events_added_subject,
        title: supplementalMessages.ko.password_changed_translations_events_added_title,
        body: supplementalMessages.ko.password_changed_translations_events_added_body,
      },
      changed: {
        subject: supplementalMessages.ko.password_changed_translations_events_changed_subject,
        title: supplementalMessages.ko.password_changed_translations_events_changed_title,
        body: supplementalMessages.ko.password_changed_translations_events_changed_body,
      },
      reset: {
        subject: supplementalMessages.ko.password_changed_translations_events_reset_subject,
        title: supplementalMessages.ko.password_changed_translations_events_reset_title,
        body: supplementalMessages.ko.password_changed_translations_events_reset_body,
      },
      removed: {
        subject: supplementalMessages.ko.password_changed_translations_events_removed_subject,
        title: supplementalMessages.ko.password_changed_translations_events_removed_title,
        body: supplementalMessages.ko.password_changed_translations_events_removed_body,
      },
    },
    ownAction: supplementalMessages.ko.password_changed_translations_ownAction,
    notYou: supplementalMessages.ko.password_changed_translations_notYou,
    button: supplementalMessages.ko.password_changed_translations_button,
    signInNote: supplementalMessages.ko.password_changed_translations_signInNote,
  },
};

interface PasswordChangedEmailProps {
  event: PasswordChangedEvent;
  /** "This wasn't me" page: removes the password and signs every device out. */
  url: string;
  locale?: EmailLocale;
}

export const getPasswordChangedEmailSubject = (
  locale: EmailLocale,
  event: PasswordChangedEvent,
): string => translations[locale].events[event].subject;

export const PasswordChangedEmail = ({ event, url, locale = "fr" }: PasswordChangedEmailProps) => {
  const translation = translations[locale];
  const eventTranslation = translation.events[event];

  return (
    <BaseLayoutSimple preview={eventTranslation.subject} locale={locale}>
      <Heading style={styles.title}>{eventTranslation.title}</Heading>
      <Text style={styles.paragraph}>{translation.greeting}</Text>
      <Text style={styles.paragraph}>{eventTranslation.body}</Text>
      <Text style={styles.paragraph}>{translation.ownAction}</Text>
      <Text style={styles.paragraph}>{translation.notYou}</Text>
      <Section style={styles.ctaSection}>
        <Button href={url} style={button}>
          {translation.button}
        </Button>
      </Section>
      <Text style={{ ...styles.small, margin: "0" }}>{translation.signInNote}</Text>
    </BaseLayoutSimple>
  );
};

const DESTRUCTIVE_COLOR = "#dc2626";

const button = {
  ...styles.button,
  backgroundColor: DESTRUCTIVE_COLOR,
  color: "#ffffff",
};
