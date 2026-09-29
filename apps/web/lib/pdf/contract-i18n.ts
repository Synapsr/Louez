import type { Locale } from "@/i18n/config";
import type { ContractTranslations } from "./contract";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";
import it from "@/messages/it.json";
import nl from "@/messages/nl.json";
import pt from "@/messages/pt.json";
import de from "@/messages/de.json";
import es from "@/messages/es.json";
import pl from "@/messages/pl.json";
import zh from "@/messages/zh.json";
import ja from "@/messages/ja.json";
import ru from "@/messages/ru.json";
import id from "@/messages/id.json";
import ko from "@/messages/ko.json";

const messages = { fr, en, it, nl, pt, de, es, pl, zh, ja, ru, id, ko };

export const getContractTranslations = (locale: Locale): ContractTranslations =>
  messages[locale].contract;
