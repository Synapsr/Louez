import { supplementalMessages } from "@/lib/i18n/supplemental-messages";
import { defaultLocale, type Locale } from "@/i18n/config";

interface InspectionDemoText {
  wearNote: string;
  departureNote: string;
  returnNote: string;
  damageNote: string;
}

const text = {
  fr: {
    wearNote: "Légère usure sur la poignée droite, déjà présente au départ.",
    departureNote: "Cadres, freins et pneus vérifiés avec le client.",
    returnNote: "Comparaison avec les photos prises au départ.",
    damageNote: "Rayure constatée sur le cadre au retour.",
  },
  en: {
    wearNote: "Slight wear on the right grip, already present at pickup.",
    departureNote: "Frames, brakes and tyres checked with the customer.",
    returnNote: "Compared with the photos taken at pickup.",
    damageNote: "Scratch found on the frame upon return.",
  },
  it: {
    wearNote: "Lieve usura sulla manopola destra, già presente alla consegna.",
    departureNote: "Telai, freni e pneumatici controllati con il cliente.",
    returnNote: "Confronto con le foto scattate alla consegna.",
    damageNote: "Graffio rilevato sul telaio alla restituzione.",
  },
  nl: {
    wearNote: "Lichte slijtage aan de rechterhandgreep, al aanwezig bij het ophalen.",
    departureNote: "Frames, remmen en banden samen met de klant gecontroleerd.",
    returnNote: "Vergeleken met de foto's van het ophalen.",
    damageNote: "Kras op het frame vastgesteld bij teruggave.",
  },
  pt: {
    wearNote: "Ligeiro desgaste no punho direito, já presente na entrega.",
    departureNote: "Quadros, travões e pneus verificados com o cliente.",
    returnNote: "Comparação com as fotografias tiradas na entrega.",
    damageNote: "Risco detetado no quadro na devolução.",
  },
  de: {
    wearNote: "Leichte Abnutzung am rechten Griff, bereits bei der Abholung vorhanden.",
    departureNote: "Rahmen, Bremsen und Reifen gemeinsam mit dem Kunden geprüft.",
    returnNote: "Vergleich mit den bei der Abholung aufgenommenen Fotos.",
    damageNote: "Bei der Rückgabe wurde ein Kratzer am Rahmen festgestellt.",
  },
  es: {
    wearNote: "Ligero desgaste en el puño derecho, ya presente en la entrega.",
    departureNote: "Cuadros, frenos y neumáticos revisados con el cliente.",
    returnNote: "Comparación con las fotos tomadas en la entrega.",
    damageNote: "Arañazo detectado en el cuadro a la devolución.",
  },
  pl: {
    wearNote: "Lekkie zużycie prawego chwytu, obecne już przy odbiorze.",
    departureNote: "Ramy, hamulce i opony sprawdzone wspólnie z klientem.",
    returnNote: "Porównanie ze zdjęciami wykonanymi przy odbiorze.",
    damageNote: "Przy zwrocie stwierdzono rysę na ramie.",
  },
  zh: {wearNote: supplementalMessages.zh.demo_inspections_wearNote,
departureNote: supplementalMessages.zh.demo_inspections_departureNote,
returnNote: supplementalMessages.zh.demo_inspections_returnNote,
damageNote: supplementalMessages.zh.demo_inspections_damageNote,},
  ja: {wearNote: supplementalMessages.ja.demo_inspections_wearNote,
departureNote: supplementalMessages.ja.demo_inspections_departureNote,
returnNote: supplementalMessages.ja.demo_inspections_returnNote,
damageNote: supplementalMessages.ja.demo_inspections_damageNote,},
  ru: {wearNote: supplementalMessages.ru.demo_inspections_wearNote,
departureNote: supplementalMessages.ru.demo_inspections_departureNote,
returnNote: supplementalMessages.ru.demo_inspections_returnNote,
damageNote: supplementalMessages.ru.demo_inspections_damageNote,},
  id: {wearNote: supplementalMessages.id.demo_inspections_wearNote,
departureNote: supplementalMessages.id.demo_inspections_departureNote,
returnNote: supplementalMessages.id.demo_inspections_returnNote,
damageNote: supplementalMessages.id.demo_inspections_damageNote,},
  ko: {wearNote: supplementalMessages.ko.demo_inspections_wearNote,
departureNote: supplementalMessages.ko.demo_inspections_departureNote,
returnNote: supplementalMessages.ko.demo_inspections_returnNote,
damageNote: supplementalMessages.ko.demo_inspections_damageNote,},
} satisfies Record<Locale, InspectionDemoText>;

export const getInspectionDemoText = (locale: Locale = defaultLocale): InspectionDemoText =>
  text[locale];
