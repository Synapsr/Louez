import type { Locale } from "@/i18n/config";

const customerText = {
  fr: {
    notes:
      "Client régulier. Préfère les vélos de ville avec panier. Préparer les antivols avant le retrait.",
    businessNotes:
      "Locations pour les déplacements de l’équipe à Nantes. Préparer les vélos ensemble au retrait.",
  },
  en: {
    notes: "Returning customer. Prefers city bikes with baskets. Prepare the locks before pickup.",
    businessNotes:
      "Bike rentals for the team’s trips around Nantes. Have the bikes ready together for pickup.",
  },
  it: {
    notes:
      "Cliente abituale. Preferisce le bici da città con cestino. Preparare i lucchetti prima del ritiro.",
    businessNotes:
      "Noleggi per gli spostamenti del team a Nantes. Preparare insieme le bici per il ritiro.",
  },
  nl: {
    notes:
      "Vaste klant. Geeft de voorkeur aan stadsfietsen met een mand. Leg de sloten klaar vóór het ophalen.",
    businessNotes:
      "Fietsverhuur voor de verplaatsingen van het team in Nantes. Zet alle fietsen samen klaar voor het ophalen.",
  },
  pt: {
    notes:
      "Cliente habitual. Prefere bicicletas urbanas com cesto. Preparar os cadeados antes da retirada.",
    businessNotes:
      "Aluguéis para os deslocamentos da equipe em Nantes. Preparar as bicicletas juntas para a retirada.",
  },
  de: {
    notes: "Stammkunde. Bevorzugt Stadträder mit Korb. Schlösser vor der Abholung bereitlegen.",
    businessNotes:
      "Fahrradmieten für die Fahrten des Teams in Nantes. Die Fahrräder gemeinsam zur Abholung bereitstellen.",
  },
  es: {
    notes:
      "Cliente habitual. Prefiere bicicletas urbanas con cesta. Preparar los candados antes de la recogida.",
    businessNotes:
      "Alquileres para los desplazamientos del equipo en Nantes. Preparar las bicicletas juntas para la recogida.",
  },
  pl: {
    notes:
      "Stały klient. Preferuje rowery miejskie z koszykiem. Przygotować zapięcia przed odbiorem.",
    businessNotes:
      "Wynajem rowerów na przejazdy zespołu po Nantes. Przygotować wszystkie rowery razem do odbioru.",
  },
} satisfies Record<Locale, { notes: string; businessNotes: string }>;

export const getDemoCustomerText = (locale: Locale = "fr") => customerText[locale];
