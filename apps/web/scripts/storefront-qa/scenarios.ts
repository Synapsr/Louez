import type { StoreSettings, StoreTheme, TulipPublicMode } from "@louez/types";

export interface QaStore {
  slug: string;
  name: string;
  count: number;
  settings?: Partial<StoreSettings>;
  theme?: Partial<StoreTheme>;
  insurance?: TulipPublicMode;
  coverage?: "all" | "mixed" | "none";
  payment?: boolean;
}

const delivery = {
  enabled: true,
  mode: "optional",
  pricePerKm: 2,
  minimumFee: 10,
  maximumDistance: 30,
  freeDeliveryThreshold: 150,
  minimumOrderAmountForDelivery: 30,
} as const;

export const qaStores: QaStore[] = [
  { slug: "vide", name: "Boutique vide", count: 0 },
  { slug: "minimal", name: "Un seul produit", count: 1 },
  { slug: "demande", name: "Réservation sur demande", count: 5 },
  {
    slug: "catalogue",
    name: "Grand catalogue",
    count: 64,
    theme: { catalogBrowseMode: "categories", heroLayout: "split" },
  },
  { slug: "produits", name: "Variantes et accessoires", count: 12 },
  {
    slug: "tarifs",
    name: "Tarifs et promotions",
    count: 12,
    settings: { tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" } },
  },
  { slug: "paiement", name: "Paiement intégral", count: 5, payment: true },
  {
    slug: "acompte",
    name: "Acompte de 30 %",
    count: 5,
    payment: true,
    settings: { onlinePaymentDepositPercentage: 30 },
  },
  {
    slug: "stripe-incomplet",
    name: "Stripe non prêt",
    count: 5,
    settings: { reservationMode: "payment" },
  },
  {
    slug: "livraison",
    name: "Livraison au choix",
    count: 5,
    settings: { delivery: { ...delivery, multiLocationEnabled: true } },
  },
  {
    slug: "livraison-obligatoire",
    name: "Livraison obligatoire",
    count: 5,
    settings: { delivery: { ...delivery, mode: "required" } },
  },
  {
    slug: "livraison-incluse",
    name: "Livraison incluse",
    count: 5,
    settings: { delivery: { ...delivery, mode: "included" } },
  },
  {
    slug: "assurance",
    name: "Assurance facultative — panier mixte",
    count: 5,
    insurance: "optional",
    coverage: "mixed",
  },
  {
    slug: "assurance-obligatoire",
    name: "Assurance obligatoire",
    count: 5,
    insurance: "required",
    coverage: "all",
  },
  {
    slug: "assurance-masquee",
    name: "Assurance non proposée en public",
    count: 5,
    insurance: "no_public",
    coverage: "all",
  },
  {
    slug: "assurance-aucun",
    name: "Aucun produit assurable",
    count: 5,
    insurance: "optional",
    coverage: "none",
  },
  {
    slug: "complet",
    name: "Livraison + assurance + acompte",
    count: 5,
    payment: true,
    insurance: "optional",
    coverage: "mixed",
    settings: {
      delivery,
      onlinePaymentDepositPercentage: 30,
      tax: { enabled: true, defaultRate: 20, displayMode: "inclusive" },
    },
  },
  {
    slug: "contraintes",
    name: "Horaires et durées",
    count: 5,
    settings: {
      advanceNoticeMinutes: 2880,
      minRentalMinutes: 1440,
      maxRentalMinutes: 10080,
      turnoverBufferMinutes: 120,
    },
  },
  {
    slug: "disponibilite",
    name: "Disponibilité et demandes non bloquantes",
    count: 5,
    settings: { pendingBlocksAvailability: false },
  },
  {
    slug: "suivi",
    name: "Compte, devis et réservations",
    count: 5,
    settings: { automaticExtensions: true, maxExtensionDays: 7 },
  },
  {
    slug: "international",
    name: "Devise et thème sombre",
    count: 5,
    theme: { mode: "dark", primaryColor: "#854d0e" },
    settings: { currency: "CHF", country: "CH", timezone: "Europe/Zurich" },
  },
];

export interface QaCase {
  id: string;
  store: string;
  title: string;
  path: string;
  steps: string;
  expected: string;
  level: "application" | "simulation" | "external";
  source: string;
}
const cases: QaCase[] = [];
function add(
  store: string,
  title: string,
  path: string,
  steps: string,
  expected: string,
  source: string,
  level: QaCase["level"] = "application",
) {
  cases.push({
    id: `QA-${String(cases.length + 1).padStart(3, "0")}`,
    store,
    title,
    path,
    steps,
    expected,
    source,
    level,
  });
}
const productSource = "apps/web/components/storefront/product/quick-add-button.tsx";
const settingsSource = "packages/types/src/store.ts";
const checkoutSource = "apps/web/lib/reservations/create-reservation.ts";
add(
  "vide",
  "Accueil et catalogue vides",
  "/",
  "Ouvrir puis visiter le catalogue.",
  "État vide lisible, aucun ajout ni erreur.",
  productSource,
);
add(
  "minimal",
  "Un produit, sans image ni description",
  "/",
  "Ouvrir la fiche et revenir à l’accueil.",
  "Image de remplacement, mise en page stable, navigation fonctionnelle.",
  productSource,
);
add(
  "catalogue",
  "Catégories et grand catalogue",
  "/catalog",
  "Parcourir les catégories, dont la catégorie vide, puis tous les produits.",
  "Navigation utilisable et résultats cohérents.",
  "apps/web/lib/storefront/catalog.queries.ts",
);
for (const [title, steps, expected] of [
  [
    "Recherche sans résultat",
    "Rechercher zzz-inexistant.",
    "Message vide, possibilité de réinitialiser.",
  ],
  [
    "Recherche et filtres combinés",
    "Rechercher Vélo, filtrer prix et disponibilité, copier l’URL puis recharger.",
    "Résultats et filtres conservés dans les paramètres prévus.",
  ],
  [
    "Dates et navigation",
    "Choisir les dates proposées, aller sur une fiche, revenir, puis recharger.",
    "Période conservée et prix cohérents.",
  ],
  [
    "Navigation mobile",
    "À 390 px, ouvrir recherche, calendrier, filtres et panier ; défiler dans les deux sens.",
    "Aucun élément inaccessible, superposition ni boucle du header.",
  ],
])
  add("catalogue", title, "/catalog", steps, expected, "apps/web/components/storefront/shell");
for (const [n, title, expected] of [
  [0, "Ajout rapide simple", "Ajout une fois, quantité et prix cohérents."],
  [5, "Variante requise", "Choix de taille requis ; unité retirée non réservable."],
  [6, "Stock nul", "Ajout impossible et état indisponible explicite."],
  [
    7,
    "Consommable au forfait",
    "Prix fixe indépendant de la durée, stock consommé à confirmation.",
  ],
  [8, "Stock non suivi", "Pas de faux plafond de disponibilité."],
  [9, "Produit brouillon", "Fiche non accessible publiquement, absent du catalogue."],
  [10, "Produit archivé", "Fiche non accessible publiquement, absent du catalogue."],
])
  add(
    "produits",
    title as string,
    `product:${n}`,
    "Ouvrir la fiche, choisir une période et tenter l’ajout.",
    expected as string,
    productSource,
  );
add(
  "produits",
  "Accessoires obligatoires et facultatifs",
  "product:0",
  "Ajouter le vélo ; observer le casque obligatoire et l’antivol facultatif ; modifier la quantité.",
  "Accessoire requis conservé et quantités/prix recalculés.",
  "apps/web/lib/utils/util.cart-lines.ts",
);
for (const [title, steps, expected] of [
  ["Panier vide", "Ouvrir le checkout avant tout ajout.", "État vide et retour vers le catalogue."],
  [
    "Quantité et suppression",
    "Ajouter deux produits puis augmenter, diminuer, supprimer et annuler la suppression.",
    "Quantités correctes ; restauration et totaux cohérents.",
  ],
  [
    "Panier après rechargement",
    "Ajouter un produit, recharger puis rouvrir le panier.",
    "Articles et période restaurés sans duplication.",
  ],
  [
    "Isolation entre boutiques",
    "Ajouter ici, puis ouvrir la boutique paiement.",
    "Le panier et les données client ne passent pas dans une autre boutique.",
  ],
  [
    "Validation client particulier",
    "Soumettre à vide, avec email invalide, puis remplir avec client@example.test.",
    "Messages utiles ; progression seulement après validation.",
  ],
  [
    "Client professionnel",
    "Choisir professionnel et compléter les champs société/adresse.",
    "Champs et récapitulatif adaptés ; erreur externe explicite si recherche entreprise indisponible.",
  ],
  [
    "Réservation sur demande complète",
    "Ajouter Vélo ville, utiliser la période proposée, remplir et confirmer.",
    "Demande créée une fois, récapitulatif et email visibles dans Mailpit.",
  ],
  [
    "Double soumission",
    "Double-cliquer sur la confirmation pendant le chargement.",
    "Une seule réservation et bouton protégé.",
  ],
])
  add("demande", title, "/checkout", steps, expected, checkoutSource);
for (const [store, title, expected] of [
  ["paiement", "Paiement intégral", "Montant complet ; réservation confirmée après retour payé."],
  ["acompte", "Acompte de 30 %", "30 % encaissés, reste à payer correct, caution distincte."],
  [
    "complet",
    "Parcours combiné",
    "Livraison et assurance incluses dans le total avant calcul de l’acompte.",
  ],
])
  add(
    store,
    title,
    "/",
    "Ajouter un produit, remplir le checkout, choisir Réussir dans le simulateur de paiement.",
    expected,
    "apps/web/lib/reservations/start-checkout-payment.ts",
    "simulation",
  );
add(
  "stripe-incomplet",
  "Dégradation en demande",
  "/",
  "Effectuer une réservation.",
  "Demande possible malgré l’intention de paiement ; aucune impasse Stripe.",
  "apps/web/lib/reservation-mode.ts",
);
for (const [title, steps, expected] of [
  [
    "Paiement annulé et repris",
    "Au simulateur, choisir Annuler, puis reprendre depuis Louez.",
    "Réservation retrouvée sans doublon.",
  ],
  [
    "Carte refusée puis nouvel essai",
    "Au simulateur, choisir Refuser puis Réussir.",
    "Aucune confirmation avant paiement ; reprise possible.",
  ],
  [
    "Retour non payé",
    "Au simulateur, choisir Retour sans paiement.",
    "Ne confirme pas la réservation.",
  ],
  [
    "Retour payé répété",
    "Réussir puis recharger le retour.",
    "Un seul paiement complété, pas de double confirmation.",
  ],
])
  add(
    "paiement",
    title,
    "/",
    steps,
    expected,
    "apps/web/lib/reservations/complete-checkout-payment.ts",
    "simulation",
  );
for (const store of ["livraison", "livraison-obligatoire", "livraison-incluse"]) {
  add(
    store,
    "Aller et retour, frais et adresses",
    "/",
    "Ajouter 2 vélos. Au checkout choisir les méthodes aller/retour. Saisir Paris puis sélectionner QA proche — 5 km.",
    "Respect du mode configuré ; 10 € par trajet proche en mode payant ; aucun frais en mode inclus.",
    "apps/web/lib/reservations/resolve-delivery.ts",
    "simulation",
  );
}
add(
  "livraison",
  "Lieux de retrait distincts",
  "/",
  "Choisir retrait au dépôt puis retour à l’annexe.",
  "Lieux enregistrés et repris dans la réservation.",
  settingsSource,
);
add(
  "livraison",
  "Distance, seuil minimum et gratuité",
  "/",
  "Saisir Paris : tester QA proche (5 km), QA hors zone (45 km), panier sous 30 € puis supérieur à 150 €.",
  "Limites et frais appliqués aux deux trajets.",
  "apps/web/lib/reservations/resolve-delivery.ts",
  "simulation",
);
for (const store of [
  "assurance",
  "assurance-obligatoire",
  "assurance-masquee",
  "assurance-aucun",
]) {
  add(
    store,
    "Couverture et mode public",
    "/",
    "Ajouter les produits 1 et 2, ouvrir le checkout et modifier le choix d’assurance si proposé.",
    "Mixte : seul le premier est couvert ; obligatoire : pas de refus ; masquée ou aucun produit : pas de supplément public.",
    "apps/web/lib/integrations/tulip/contracts.ts",
    "simulation",
  );
}
add(
  "assurance",
  "Devis assurance en erreur",
  "/",
  "Dans le panneau de recette choisir Tulip erreur, puis ouvrir un nouveau checkout. Revenir à Normal pour reprendre.",
  "Erreur visible, pas de montant inventé, reprise possible.",
  "apps/web/lib/integrations/tulip/client.ts",
  "simulation",
);
add(
  "assurance",
  "Devis assurance lent",
  "/",
  "Choisir Tulip lent puis modifier dates et quantités.",
  "Chargement visible ; aucun devis périmé appliqué au nouveau panier.",
  "apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-tulip-quote.ts",
  "simulation",
);
for (const [n, title, expected] of [
  [0, "Tarif journalier", "Deux jours à 25 € = 50 € HT hors taxe et accessoires."],
  [1, "Tarif horaire", "Facturation selon les heures."],
  [2, "Tarif hebdomadaire", "Facturation selon les semaines."],
  [3, "Forfait", "Prix fixe sur la période."],
  [4, "Paliers stricts", "Durée limitée aux forfaits disponibles."],
  [5, "Tarif saisonnier", "Prix haute saison appliqué aux dates indiquées."],
]) {
  add(
    "tarifs",
    title as string,
    `product:${n}`,
    "Choisir une période, changer la durée et comparer fiche/panier/checkout.",
    expected as string,
    "packages/api/src/services/pricing-catalog.ts",
  );
}
for (const code of ["QA10", "QA5", "EXPIRE", "EPUISE", "MIN100", "INCONNU"]) {
  add(
    "tarifs",
    `Code ${code}`,
    "/checkout",
    `Ajouter un produit puis appliquer ${code}. Retirer le code après le test.`,
    "QA10 : −10 % ; QA5 : −5 € ; EXPIRE/EPUISE/INCONNU refusés ; MIN100 exige 100 €.",
    "packages/api/src/services/promo.ts",
  );
}
add(
  "contraintes",
  "Préavis, durée, fermeture et remise en stock",
  "/",
  "Tester demain, moins de 24 h, plus de 7 jours, dimanche et période de fermeture indiquée.",
  "Dates interdites et raisons cohérentes ; délai de remise en stock respecté.",
  settingsSource,
);
add(
  "disponibilite",
  "Demandes en attente non bloquantes",
  "product:0",
  "Choisir les dates proposées ; comparer avec la boutique demande.",
  "La demande pending ne bloque pas ici ; confirmed bloque dans les deux boutiques.",
  "packages/db/src/unit-availability.ts",
);
for (const status of [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
]) {
  add(
    "suivi",
    `Réservation ${status}`,
    `reservation:${status}`,
    "Ouvrir le lien client préparé ; examiner récapitulatif, timeline et actions.",
    "Actions autorisées uniquement pour ce statut ; aucune information d’un autre client.",
    "apps/web/lib/reservations/util.reservation-actions.ts",
  );
}
for (const status of [
  "none",
  "pending",
  "card_saved",
  "authorized",
  "captured",
  "released",
  "failed",
]) {
  add(
    "suivi",
    `Caution ${status}`,
    `deposit:${status}`,
    "Ouvrir la réservation et examiner montant, texte et actions de caution.",
    "Affichage adapté au statut ; montant distinct de la location. Les saisies Stripe Elements exigent une sandbox réelle.",
    "apps/web/lib/reservations/util.payment-status.ts",
  );
}
add(
  "suivi",
  "Connexion par code et profil",
  "/account/login",
  "Demander un code pour client@example.test ; le lire dans Mailpit ; modifier le profil.",
  "Connexion réelle, erreurs de code gérées et modifications persistées.",
  "apps/web/lib/customer-auth",
);
add(
  "suivi",
  "Devis accepté ou refusé",
  "reservation:quote",
  "Accepter le devis. Après réinitialisation, refuser.",
  "Statut et actions mis à jour sans paiement forcé en mode demande.",
  "apps/web/lib/reservations/util.reservation-actions.ts",
);
add(
  "suivi",
  "Prolongation et changement de dates",
  "reservation:confirmed",
  "Ouvrir les actions de dates, demander une prolongation et essayer une date indisponible.",
  "Prix, disponibilité et règles de statut respectés.",
  "apps/web/lib/reservations/extension-service.ts",
);
add(
  "suivi",
  "Contrat et calendrier",
  "reservation:confirmed",
  "Télécharger le contrat et le calendrier depuis les actions disponibles.",
  "Fichiers lisibles avec dates, produits et montants corrects.",
  "apps/web/lib/reservations/util.calendar-links.ts",
);
for (const route of ["/about", "/legal", "/terms", "/embed", "/rental"]) {
  add(
    "demande",
    `Page ${route}`,
    route,
    "Ouvrir sur ordinateur et mobile.",
    "Contenu accessible, navigation et mise en page correctes.",
    "apps/web/app/(storefront)/[slug]",
  );
}
add(
  "international",
  "Devise, langue et thème sombre",
  "/",
  "Basculer les langues disponibles puis parcourir catalogue, panier et checkout.",
  "CHF, formats de date, textes et contrastes cohérents.",
  settingsSource,
);
add(
  "demande",
  "Réseau indisponible et reprise",
  "/",
  "Dans les outils navigateur activer Offline pendant une recherche/validation, puis revenir en ligne.",
  "Erreur récupérable, aucune confirmation fictive.",
  checkoutSource,
);
add(
  "paiement",
  "Stripe Connect réel et webhooks",
  "/",
  "Dans une recette d’intégration distincte, utiliser une sandbox Stripe, tester paiement, 3DS, webhook répété et retour sans navigateur.",
  "Paiement et confirmation vérifiés chez Stripe et en base. Non couvert par le simulateur local.",
  "apps/web/app/api/webhooks/stripe/connect/route.ts",
  "external",
);
add(
  "assurance",
  "Contrat Tulip réel",
  "/",
  "Avec des accès Tulip de test vérifiés, comparer le devis puis le contrat créé et son annulation.",
  "Contrat présent chez Tulip, produits et montant corrects. Non couvert par le simulateur local.",
  "apps/web/lib/integrations/tulip/contracts.ts",
  "external",
);
export const qaCases = cases;
