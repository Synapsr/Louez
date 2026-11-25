/**
 * Invented people for demo stores. Names are drawn from common French first and
 * last names and paired at random: no row describes a real person. E-mails use
 * the reserved `.example` domain and phone numbers the ARCEP fiction range
 * 06 39 98, so nothing in a demo store can reach anyone.
 */

export const DEMO_FIRST_NAMES = [
  "Camille",
  "Léa",
  "Manon",
  "Chloé",
  "Emma",
  "Inès",
  "Jade",
  "Louise",
  "Alice",
  "Juliette",
  "Lucas",
  "Hugo",
  "Louis",
  "Gabriel",
  "Arthur",
  "Jules",
  "Nathan",
  "Théo",
  "Raphaël",
  "Adam",
  "Sophie",
  "Claire",
  "Anne",
  "Marion",
  "Pauline",
  "Julien",
  "Nicolas",
  "Thomas",
  "Antoine",
  "Maxime",
];

export const DEMO_LAST_NAMES = [
  "Martin",
  "Bernard",
  "Petit",
  "Durand",
  "Leroy",
  "Moreau",
  "Simon",
  "Laurent",
  "Lefebvre",
  "Michel",
  "Garcia",
  "David",
  "Bertrand",
  "Roux",
  "Vincent",
  "Fournier",
  "Morel",
  "Girard",
  "André",
  "Mercier",
  "Dupont",
  "Lambert",
  "Bonnet",
  "François",
  "Martinez",
  "Legrand",
  "Garnier",
  "Faure",
  "Rousseau",
  "Blanc",
];

export const DEMO_TOWNS = [
  { city: "Paris", postalCode: "75011" },
  { city: "Lyon", postalCode: "69003" },
  { city: "Nantes", postalCode: "44000" },
  { city: "Bordeaux", postalCode: "33000" },
  { city: "Lille", postalCode: "59000" },
  { city: "Rennes", postalCode: "35000" },
  { city: "Grenoble", postalCode: "38000" },
  { city: "Annecy", postalCode: "74000" },
  { city: "Toulouse", postalCode: "31000" },
  { city: "Strasbourg", postalCode: "67000" },
];

export const DEMO_STREETS = [
  "rue des Lilas",
  "avenue de la Gare",
  "rue du Moulin",
  "impasse des Tilleuls",
  "rue Victor-Hugo",
  "boulevard Pasteur",
  "rue de la République",
  "chemin des Vignes",
  "place du Marché",
  "rue des Écoles",
];

/** The persona a visitor books as on a demo storefront: their own details never reach the store. */
export const DEMO_VISITOR_CUSTOMER = {
  firstName: "Alex",
  lastName: "Visiteur",
  phone: "06 39 98 00 00",
} as const;

/** The reserved domain of every e-mail a demo store holds. */
export const DEMO_EMAIL_DOMAIN = "demo.example";

export const slugifyName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
