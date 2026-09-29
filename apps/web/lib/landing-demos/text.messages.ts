import { supplementalMessages, formatSupplementalMessage } from "@/lib/i18n/supplemental-messages";
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
  zh: {sender: supplementalMessages.zh.demo_messages_sender,
now: supplementalMessages.zh.demo_messages_now,
message: supplementalMessages.zh.demo_messages_message,
characters: supplementalMessages.zh.demo_messages_characters,
segments: (count: number) => formatSupplementalMessage("zh", "demo_messages_segments", { count }),},
  ja: {sender: supplementalMessages.ja.demo_messages_sender,
now: supplementalMessages.ja.demo_messages_now,
message: supplementalMessages.ja.demo_messages_message,
characters: supplementalMessages.ja.demo_messages_characters,
segments: (count: number) => formatSupplementalMessage("ja", "demo_messages_segments", { count }),},
  ru: {sender: supplementalMessages.ru.demo_messages_sender,
now: supplementalMessages.ru.demo_messages_now,
message: supplementalMessages.ru.demo_messages_message,
characters: supplementalMessages.ru.demo_messages_characters,
segments: (count: number) => formatSupplementalMessage("ru", "demo_messages_segments", { count }),},
  id: {sender: supplementalMessages.id.demo_messages_sender,
now: supplementalMessages.id.demo_messages_now,
message: supplementalMessages.id.demo_messages_message,
characters: supplementalMessages.id.demo_messages_characters,
segments: (count: number) => formatSupplementalMessage("id", "demo_messages_segments", { count }),},
  ko: {sender: supplementalMessages.ko.demo_messages_sender,
now: supplementalMessages.ko.demo_messages_now,
message: supplementalMessages.ko.demo_messages_message,
characters: supplementalMessages.ko.demo_messages_characters,
segments: (count: number) => formatSupplementalMessage("ko", "demo_messages_segments", { count }),},
} satisfies Record<Locale, MessageDemoText>;

export const getMessageDemoText = (locale: Locale = "fr"): MessageDemoText => messages[locale];
