import fr from "@/messages/landing-demos/fr.json";
import en from "@/messages/landing-demos/en.json";
import it from "@/messages/landing-demos/it.json";
import nl from "@/messages/landing-demos/nl.json";
import pt from "@/messages/landing-demos/pt.json";
import de from "@/messages/landing-demos/de.json";
import es from "@/messages/landing-demos/es.json";
import pl from "@/messages/landing-demos/pl.json";
import zh from "@/messages/landing-demos/zh.json";
import ja from "@/messages/landing-demos/ja.json";
import ru from "@/messages/landing-demos/ru.json";
import id from "@/messages/landing-demos/id.json";
import ko from "@/messages/landing-demos/ko.json";
import { type Locale, defaultLocale, isLocale } from "@/i18n/config";

// Demo fixtures and host labels live in their own small message catalogs.
export interface DemoText {
  products: Record<string, string>;
  categories: Record<string, string>;
  depositAuthorized: string;
  paymentReceived: string;
  advisorReply: string;
  customerNotes: string;
  internalNotes: string;
  steps: [string, string, string];
  customer: string;
  owner: string;
  play: string;
  pause: string;
  restart: string;
  toggleMenu: string;
}

const messages = { fr, en, it, nl, pt, de, es, pl, zh, ja, ru, id, ko };

export const getDemoText = (locale: Locale = defaultLocale): DemoText => {
  const message = messages[locale];
  return { ...message, steps: [message.steps[0], message.steps[1], message.steps[2]] };
};

/** The demo language, from the `locale` query parameter; French when absent or unknown. */
export const getDemoLocale = (value: string | string[] | undefined): Locale => {
  const first = Array.isArray(value) ? value[0] : value;
  return isLocale(first) ? first : defaultLocale;
};
