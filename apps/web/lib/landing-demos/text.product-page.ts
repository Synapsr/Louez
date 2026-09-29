import type { Locale } from "@/i18n/config";

interface ProductPageText {
  description: string;
  helmet: string;
}

const text: Record<Locale, ProductPageText> = {
  fr: {
    description:
      "Un vélo confortable pour découvrir Nantes et les bords de Loire. Selle réglable, éclairage et porte-bagages pour vos balades en ville. Notre équipe règle le vélo avant votre départ.",
    helmet: "Casque vélo",
  },
  en: {
    description:
      "A comfortable bike for exploring Nantes and the banks of the Loire. Adjustable saddle, lights and a luggage rack for city rides. Our team adjusts the bike before you set off.",
    helmet: "Bike helmet",
  },
  it: {
    description:
      "Una bici comoda per scoprire Nantes e le rive della Loira. Sella regolabile, luci e portapacchi per le passeggiate in città. Il nostro team regola la bici prima della partenza.",
    helmet: "Casco da bici",
  },
  nl: {
    description:
      "Een comfortabele fiets om Nantes en de oevers van de Loire te ontdekken. Verstelbaar zadel, verlichting en bagagedrager voor ritten in de stad. Ons team stelt de fiets af voor vertrek.",
    helmet: "Fietshelm",
  },
  pt: {
    description:
      "Uma bicicleta confortável para descobrir Nantes e as margens do Loire. Selim ajustável, luzes e porta-bagagens para passeios pela cidade. A nossa equipa ajusta a bicicleta antes da partida.",
    helmet: "Capacete de bicicleta",
  },
  de: {
    description:
      "Ein bequemes Fahrrad für Nantes und die Ufer der Loire. Verstellbarer Sattel, Beleuchtung und Gepäckträger für Stadtfahrten. Unser Team stellt das Fahrrad vor Ihrer Abfahrt ein.",
    helmet: "Fahrradhelm",
  },
  es: {
    description:
      "Una bicicleta cómoda para descubrir Nantes y las orillas del Loira. Sillín ajustable, luces y portaequipajes para pasear por la ciudad. Nuestro equipo ajusta la bicicleta antes de la salida.",
    helmet: "Casco de bicicleta",
  },
  pl: {
    description:
      "Wygodny rower do zwiedzania Nantes i brzegów Loary. Regulowane siodełko, oświetlenie i bagażnik na miejskie przejażdżki. Nasz zespół dopasuje rower przed wyjazdem.",
    helmet: "Kask rowerowy",
  },
};

export const getDemoProductPageText = (locale: Locale = "fr"): ProductPageText => text[locale];
