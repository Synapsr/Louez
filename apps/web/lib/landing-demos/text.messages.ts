import type { Locale } from "@/i18n/config";

type MessageDemoText = {
  sender: string;
  now: string;
  message: string;
  characters: string;
  segments: (count: number) => string;
};

const messages = {
  fr: {
    sender: "Expéditeur",
    now: "Maintenant",
    message: "Message",
    characters: "caractères",
    segments: (count: number) => `${count} SMS seront envoyés`,
  },
  en: {
    sender: "Sender",
    now: "Now",
    message: "Message",
    characters: "characters",
    segments: (count: number) => `${count} SMS messages will be sent`,
  },
  it: {
    sender: "Mittente",
    now: "Ora",
    message: "Messaggio",
    characters: "caratteri",
    segments: (count: number) => `Verranno inviati ${count} SMS`,
  },
  nl: {
    sender: "Afzender",
    now: "Nu",
    message: "Bericht",
    characters: "tekens",
    segments: (count: number) => `Er worden ${count} sms-berichten verzonden`,
  },
  pt: {
    sender: "Remetente",
    now: "Agora",
    message: "Mensagem",
    characters: "caracteres",
    segments: (count: number) => `Serão enviados ${count} SMS`,
  },
  de: {
    sender: "Absender",
    now: "Jetzt",
    message: "Nachricht",
    characters: "Zeichen",
    segments: (count: number) => `${count} SMS werden gesendet`,
  },
  es: {
    sender: "Remitente",
    now: "Ahora",
    message: "Mensaje",
    characters: "caracteres",
    segments: (count: number) => `Se enviarán ${count} SMS`,
  },
  pl: {
    sender: "Nadawca",
    now: "Teraz",
    message: "Wiadomość",
    characters: "znaków",
    segments: (count: number) => `Zostanie wysłanych ${count} SMS-ów`,
  },
} satisfies Record<Locale, MessageDemoText>;

export const getMessageDemoText = (locale: Locale = "fr"): MessageDemoText => messages[locale];
