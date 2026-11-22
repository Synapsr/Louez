import {
  DEMO_CATEGORIES,
  DEMO_PRODUCTS,
  DEMO_PROMO_CODES,
  DEMO_STORE,
  DEMO_VARIANT_DEFINITIONS,
  type DemoProduct,
  type SourcedImageKey,
} from "@/scripts/seed/demo/catalog";
import sourcedImages from "@/scripts/seed/demo/demo-images.json";

import type { DemoProductSpec, DemoVertical } from "./types";

/**
 * « Location de vélos »: the hand-curated « Ar Mor Location » catalog of the
 * demo seed (scripts/seed/demo), reused as it is. Its contact details are
 * replaced by invented ones: the seed's are only ever shown in recordings.
 */

const sourced = sourcedImages.images as Partial<Record<SourcedImageKey, string>>;

const imagesOf = (spec: DemoProduct): string[] => {
  const primary = spec.sourcedImage ? sourced[spec.sourcedImage] : undefined;
  return primary ? [primary, ...spec.images.filter((image) => image !== primary)] : spec.images;
};

const BIKE_ACCESSORIES = ["casque-adulte", "antivol", "sacoches", "kit-repa"];
const FAMILY_ACCESSORIES = ["siege-bebe", "remorque-enfant", "casque-enfant"];

const toSpec = (spec: DemoProduct): DemoProductSpec => ({
  key: spec.key,
  name: spec.name,
  category: spec.category,
  description: spec.description,
  ...(spec.aiContext ? { aiContext: spec.aiContext } : {}),
  images: imagesOf(spec),
  price: spec.price,
  basePeriodMinutes: spec.basePeriodMinutes,
  pricingMode: spec.pricingMode,
  deposit: spec.deposit,
  rates: spec.rates,
  enforceStrictTiers: spec.enforceStrictTiers,
  quantity: spec.quantity,
  trackUnits: spec.trackUnits,
  ...(spec.axes ? { axes: spec.axes } : {}),
  ...(spec.units ? { units: spec.units } : {}),
  ...(spec.unitPrefix ? { unitPrefix: spec.unitPrefix } : {}),
  popularity: spec.popularity,
  ...(spec.seasons ? { seasons: spec.seasons } : {}),
  ...(spec.isAccessory ? { isAccessory: true } : {}),
  ...(spec.category === "Vélos & VAE"
    ? {
        accessories: ["cargo", "longtail", "kid-20", "kid-24"].includes(spec.key)
          ? [...FAMILY_ACCESSORIES, "casque-adulte"]
          : BIKE_ACCESSORIES,
      }
    : {}),
  ...(spec.unitPurchasePrice ? { unitPurchasePrice: spec.unitPurchasePrice } : {}),
});

// Active products with a photo: a demo storefront shows no empty tile.
const products = DEMO_PRODUCTS.filter((spec) => spec.status === "active")
  .map(toSpec)
  .filter((product) => product.images.length > 0);
const has = (key: string) => products.some((product) => product.key === key);

export const VELO_VERTICAL: DemoVertical = {
  key: "velo",
  label: "Location de vélos",
  store: {
    name: DEMO_STORE.name,
    slugBase: DEMO_STORE.slug,
    tagline: "<p>Vélos, VAE, paddles et kayaks pour explorer la côte et la voie verte.</p>",
    description: DEMO_STORE.description,
    email: "contact@ar-mor-location.example",
    phone: "02 61 91 41 62",
    address: DEMO_STORE.address,
    city: DEMO_STORE.city,
    postalCode: DEMO_STORE.postalCode,
    latitude: DEMO_STORE.latitude,
    longitude: DEMO_STORE.longitude,
    primaryColor: DEMO_STORE.primaryColor,
    heroImages: products
      .slice(0, 2)
      .map((product) => product.images[0])
      .filter(Boolean),
    vatNumber: "FR00999999997",
    ownerName: "Gwenaëlle Le Bris",
  },
  settings: {
    minRentalMinutes: 240,
    advanceNoticeMinutes: 120,
    turnoverBufferMinutes: 45,
    onlinePaymentDepositPercentage: 30,
    openingHours: [
      [{ openTime: "09:30", closeTime: "12:30" }],
      [
        { openTime: "09:00", closeTime: "12:30" },
        { openTime: "14:00", closeTime: "19:00" },
      ],
      [
        { openTime: "09:00", closeTime: "12:30" },
        { openTime: "14:00", closeTime: "19:00" },
      ],
      [
        { openTime: "09:00", closeTime: "12:30" },
        { openTime: "14:00", closeTime: "19:00" },
      ],
      [
        { openTime: "09:00", closeTime: "12:30" },
        { openTime: "14:00", closeTime: "19:00" },
      ],
      [
        { openTime: "09:00", closeTime: "12:30" },
        { openTime: "14:00", closeTime: "19:00" },
      ],
      [{ openTime: "09:00", closeTime: "19:00" }],
    ],
  },
  categories: DEMO_CATEGORIES.map(({ name, description }) => ({ name, description })),
  variantDefinitions: DEMO_VARIANT_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    kind: definition.kind,
    values: definition.values.map((value) => value.label),
  })),
  products,
  monthWeights: [0.3, 0.35, 0.6, 1.3, 1.6, 2.2, 3.6, 3.6, 1.6, 0.8, 0.4, 0.35],
  durations: [
    { days: 1, weight: 40 },
    { days: 2, weight: 18 },
    { days: 3, weight: 14 },
    { days: 7, weight: 10 },
  ],
  baskets: [
    {
      weight: 30,
      lines: [
        { key: "vae-trekking", quantity: 2 },
        { key: "casque-adulte", quantity: 2 },
      ],
    },
    {
      weight: 24,
      lines: [
        { key: "vae-confort", quantity: 2 },
        { key: "kid-20", quantity: 1 },
        { key: "casque-enfant", quantity: 1 },
      ],
    },
    { weight: 15, lines: [{ key: "vttae", quantity: 1 }] },
    {
      weight: 12,
      lines: [
        { key: "cargo", quantity: 1 },
        { key: "siege-bebe", quantity: 1 },
      ],
    },
    {
      weight: 10,
      lines: [
        { key: "gravel", quantity: 1 },
        { key: "sacoches", quantity: 1 },
      ],
    },
  ].map((basket) => ({ ...basket, lines: basket.lines.filter((line) => has(line.key)) })),
  customerNotes: [
    "Nous arrivons vers 10 h par le train, le retrait est-il possible un peu plus tôt ?",
    "Merci de prévoir deux casques adultes et un casque enfant.",
    "Je fais 1,58 m, merci de prévoir une petite taille.",
    "Retour possible en fin de journée le dimanche ?",
  ],
  internalNotes: [
    "Client habituel.",
    "Batterie chargée à 100 % la veille au soir.",
    "Vérifier la pression des pneus au départ.",
  ],
  promoCodes: DEMO_PROMO_CODES.filter((promo) => promo.isActive).map((promo) => ({
    code: promo.code,
    description: promo.description,
    type: promo.type,
    value: promo.value,
    minimumAmount: promo.minimumAmount,
    currentUsageCount: promo.currentUsageCount,
  })),
  inspectionFields: [
    {
      name: "État général",
      fieldType: "select",
      options: ["Neuf", "Bon", "Usure normale", "Dégradé"],
      isRequired: true,
      sectionName: "Général",
    },
    {
      name: "Freins et transmission",
      fieldType: "checkbox",
      isRequired: true,
      sectionName: "Vélo",
    },
    {
      name: "Niveau de batterie",
      fieldType: "number",
      numberUnit: "%",
      isRequired: false,
      sectionName: "Vélo",
    },
    {
      name: "Accessoires remis (casque, antivol)",
      fieldType: "checkbox",
      isRequired: true,
      sectionName: "Général",
    },
    { name: "Remarques", fieldType: "text", isRequired: false, sectionName: "Général" },
  ],
  featuredProductKey: "vae-trekking",
  guide: [
    {
      key: "book",
      title: "Réservez un vélo électrique",
      description:
        "Ouvrez la boutique, choisissez un VAE et sa taille, puis réservez comme un client. L'acompte est simulé.",
    },
    {
      key: "see_booking",
      title: "Voyez la réservation arriver",
      description: "Elle apparaît dans Réservations, avec le vélo attribué à la taille choisie.",
    },
    {
      key: "check_in",
      title: "Faites l'état des lieux de départ",
      description: "Sur un départ du jour : freins, batterie, accessoires, signature du client.",
    },
    {
      key: "deposit",
      title: "Gérez la caution",
      description:
        "Sur une location en cours : la caution enregistrée, puis sa restitution au retour.",
    },
  ],
  cgv: "<h2>Conditions générales de location</h2><p>Boutique de démonstration : ces conditions sont un exemple.</p><p>Le matériel est loué pour la durée indiquée dans la réservation. Une caution est demandée au retrait. Casque et antivol fournis.</p>",
};
