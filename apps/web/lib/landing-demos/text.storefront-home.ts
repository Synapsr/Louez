import { supplementalMessages } from "@/lib/i18n/supplemental-messages";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

interface StorefrontHomeDemoText {
  announcement: string;
  tagline: string;
}

const text: Record<Locale, StorefrontHomeDemoText> = {
  fr: {
    announcement: "Votre prochaine escapade commence à Nantes — réservez votre vélo en ligne",
    tagline: "Des vélos pour explorer Nantes et les bords de Loire, à votre rythme.",
  },
  en: {
    announcement: "Your next adventure starts in Nantes — book your bike online",
    tagline: "Bikes for exploring Nantes and the banks of the Loire at your own pace.",
  },
  it: {
    announcement: "La tua prossima avventura parte da Nantes — prenota la bici online",
    tagline: "Bici per esplorare Nantes e le rive della Loira, al tuo ritmo.",
  },
  nl: {
    announcement: "Je volgende avontuur begint in Nantes — reserveer je fiets online",
    tagline: "Fietsen om Nantes en de oevers van de Loire op je eigen tempo te ontdekken.",
  },
  pt: {
    announcement: "Sua próxima aventura começa em Nantes — reserve sua bicicleta online",
    tagline: "Bicicletas para explorar Nantes e as margens do Loire no seu ritmo.",
  },
  de: {
    announcement: "Dein nächstes Abenteuer beginnt in Nantes — buche dein Fahrrad online",
    tagline: "Entdecke Nantes und das Loire-Ufer mit dem Fahrrad in deinem eigenen Tempo.",
  },
  es: {
    announcement: "Tu próxima aventura empieza en Nantes — reserva tu bicicleta en línea",
    tagline: "Bicicletas para explorar Nantes y las orillas del Loira a tu ritmo.",
  },
  pl: {
    announcement: "Twoja kolejna przygoda zaczyna się w Nantes — zarezerwuj rower online",
    tagline: "Rowery do odkrywania Nantes i brzegów Loary we własnym tempie.",
  },
  zh: {announcement: supplementalMessages.zh.demo_storefront_home_announcement,
tagline: supplementalMessages.zh.demo_storefront_home_tagline,},
  ja: {announcement: supplementalMessages.ja.demo_storefront_home_announcement,
tagline: supplementalMessages.ja.demo_storefront_home_tagline,},
  ru: {announcement: supplementalMessages.ru.demo_storefront_home_announcement,
tagline: supplementalMessages.ru.demo_storefront_home_tagline,},
  id: {announcement: supplementalMessages.id.demo_storefront_home_announcement,
tagline: supplementalMessages.id.demo_storefront_home_tagline,},
  ko: {announcement: supplementalMessages.ko.demo_storefront_home_announcement,
tagline: supplementalMessages.ko.demo_storefront_home_tagline,},
};

export const getStorefrontHomeDemoText = (locale?: string): StorefrontHomeDemoText =>
  text[isLocale(locale) ? locale : defaultLocale];
