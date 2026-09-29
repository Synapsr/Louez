import type { Locale } from "@/i18n/config";

const descriptions: Record<Locale, string> = {
  fr: "Un vélo confortable pour découvrir Nantes et les bords de Loire. Réglage de la selle et vérification avant chaque départ.",
  en: "A comfortable bike for exploring Nantes and the banks of the Loire. Saddle adjustment and a safety check before every departure.",
  it: "Una bici comoda per scoprire Nantes e le rive della Loira. Regolazione della sella e controllo prima di ogni partenza.",
  nl: "Een comfortabele fiets om Nantes en de oevers van de Loire te ontdekken. Zadelafstelling en controle voor elk vertrek.",
  pt: "Uma bicicleta confortável para descobrir Nantes e as margens do Loire. Ajuste do selim e verificação antes de cada saída.",
  de: "Ein bequemes Fahrrad für Nantes und die Ufer der Loire. Satteleinstellung und Sicherheitsprüfung vor jeder Abfahrt.",
  es: "Una bicicleta cómoda para descubrir Nantes y las orillas del Loira. Ajuste del sillín y revisión antes de cada salida.",
  pl: "Wygodny rower do zwiedzania Nantes i brzegów Loary. Regulacja siodełka i kontrola przed każdym wyjazdem.",
};

export const getDemoProductsText = (locale: Locale = "fr") => ({
  description: descriptions[locale],
});
