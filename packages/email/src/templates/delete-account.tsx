import { Button, Heading, Section, Text } from "@react-email/components";

import type { EmailLocale } from "../types";
import { BaseLayoutSimple } from "./base-layout-simple";
import { styles } from "./theme";

interface DeleteAccountTranslation {
  subject: string;
  title: string;
  greeting: string;
  body: string;
  button: string;
  warning: string;
  ignore: string;
}

const translations: Record<EmailLocale, DeleteAccountTranslation> = {
  fr: {
    subject: "Confirmez la suppression de votre compte Louez",
    title: "Supprimer votre compte Louez",
    greeting: "Bonjour,",
    body: "Vous avez demandé la suppression de votre compte, de vos boutiques et de leurs données. Ouvrez la page de confirmation pour vérifier une dernière fois cette action.",
    button: "Continuer la suppression",
    warning:
      "Rien ne sera supprimé tant que vous n’aurez pas confirmé sur cette page. Le lien expire dans 24 heures.",
    ignore:
      "Si vous n’êtes pas à l’origine de cette demande, ignorez cet email et votre compte restera inchangé.",
  },
  en: {
    subject: "Confirm deletion of your Louez account",
    title: "Delete your Louez account",
    greeting: "Hello,",
    body: "You asked to delete your account, your stores and their data. Open the confirmation page to review this action one last time.",
    button: "Continue account deletion",
    warning:
      "Nothing will be deleted until you confirm on that page. The link expires in 24 hours.",
    ignore:
      "If you did not make this request, ignore this email and your account will remain unchanged.",
  },
  de: {
    subject: "Löschung Ihres Louez-Kontos bestätigen",
    title: "Ihr Louez-Konto löschen",
    greeting: "Hallo,",
    body: "Sie haben die Löschung Ihres Kontos, Ihrer Shops und der zugehörigen Daten angefordert. Öffnen Sie die Bestätigungsseite, um diesen Vorgang ein letztes Mal zu prüfen.",
    button: "Löschung fortsetzen",
    warning:
      "Es wird nichts gelöscht, bevor Sie dies auf der Seite bestätigen. Der Link ist 24 Stunden gültig.",
    ignore:
      "Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail. Ihr Konto bleibt unverändert.",
  },
  es: {
    subject: "Confirma la eliminación de tu cuenta Louez",
    title: "Eliminar tu cuenta Louez",
    greeting: "Hola,",
    body: "Has solicitado eliminar tu cuenta, tus tiendas y sus datos. Abre la página de confirmación para revisar esta acción por última vez.",
    button: "Continuar con la eliminación",
    warning:
      "No se eliminará nada hasta que lo confirmes en esa página. El enlace caduca en 24 horas.",
    ignore: "Si no has realizado esta solicitud, ignora este correo y tu cuenta no cambiará.",
  },
  it: {
    subject: "Conferma l’eliminazione del tuo account Louez",
    title: "Elimina il tuo account Louez",
    greeting: "Ciao,",
    body: "Hai richiesto di eliminare il tuo account, i tuoi negozi e i relativi dati. Apri la pagina di conferma per controllare un’ultima volta questa azione.",
    button: "Continua con l’eliminazione",
    warning:
      "Non verrà eliminato nulla finché non confermerai su quella pagina. Il link scade tra 24 ore.",
    ignore:
      "Se non hai effettuato questa richiesta, ignora questa email e il tuo account resterà invariato.",
  },
  nl: {
    subject: "Bevestig de verwijdering van uw Louez-account",
    title: "Uw Louez-account verwijderen",
    greeting: "Hallo,",
    body: "U hebt gevraagd om uw account, uw winkels en de bijbehorende gegevens te verwijderen. Open de bevestigingspagina om deze actie nog één keer te controleren.",
    button: "Doorgaan met verwijderen",
    warning:
      "Er wordt niets verwijderd totdat u dit op die pagina bevestigt. De link verloopt na 24 uur.",
    ignore: "Hebt u dit niet aangevraagd, negeer dan deze e-mail. Uw account blijft ongewijzigd.",
  },
  pl: {
    subject: "Potwierdź usunięcie konta Louez",
    title: "Usuń konto Louez",
    greeting: "Dzień dobry,",
    body: "Poproszono o usunięcie Twojego konta, sklepów i powiązanych danych. Otwórz stronę potwierdzenia, aby po raz ostatni sprawdzić tę operację.",
    button: "Kontynuuj usuwanie",
    warning:
      "Nic nie zostanie usunięte, dopóki nie potwierdzisz tego na stronie. Link wygaśnie po 24 godzinach.",
    ignore: "Jeśli to nie Ty wysłałeś tę prośbę, zignoruj wiadomość. Konto pozostanie bez zmian.",
  },
  pt: {
    subject: "Confirme a eliminação da sua conta Louez",
    title: "Eliminar a sua conta Louez",
    greeting: "Olá,",
    body: "Pediu para eliminar a sua conta, as suas lojas e os respetivos dados. Abra a página de confirmação para rever esta ação uma última vez.",
    button: "Continuar a eliminação",
    warning: "Nada será eliminado até confirmar nessa página. O link expira dentro de 24 horas.",
    ignore: "Se não fez este pedido, ignore este email e a sua conta permanecerá inalterada.",
  },
};

interface DeleteAccountEmailProps {
  url: string;
  locale?: EmailLocale;
}

export const getDeleteAccountEmailSubject = (locale: EmailLocale): string =>
  translations[locale].subject;

export const DeleteAccountEmail = ({ url, locale = "fr" }: DeleteAccountEmailProps) => {
  const translation = translations[locale];

  return (
    <BaseLayoutSimple preview={translation.subject} locale={locale}>
      <Heading style={styles.title}>{translation.title}</Heading>
      <Text style={styles.paragraph}>{translation.greeting}</Text>
      <Text style={styles.paragraph}>{translation.body}</Text>
      <Section style={styles.ctaSection}>
        <Button href={url} style={button}>
          {translation.button}
        </Button>
      </Section>
      <Text style={styles.paragraph}>{translation.warning}</Text>
      <Text style={{ ...styles.small, margin: "0" }}>{translation.ignore}</Text>
    </BaseLayoutSimple>
  );
};

const DESTRUCTIVE_COLOR = "#dc2626";

const button = {
  ...styles.button,
  backgroundColor: DESTRUCTIVE_COLOR,
  color: "#ffffff",
};
