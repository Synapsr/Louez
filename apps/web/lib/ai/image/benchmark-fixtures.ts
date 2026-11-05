export const IMAGE_PROCESSING_BENCHMARK_SCOPE_ID = "_dev-image-benchmark";
export const IMAGE_PROCESSING_BENCHMARK_FILTER = "benchmark";

const FIXTURE_BASE_URL = "https://louez-dev.s3.fr-par.scw.cloud/demo/ar-mor-location/products";

export const IMAGE_PROCESSING_BENCHMARK_CASES = [
  {
    id: "cropped-wing",
    productName: "Aile de wingfoil",
    label: "Wing volontairement cropée",
    description: "Valide la conservation du cadrage et l’absence de marges ajoutées.",
    previewUrl: `${FIXTURE_BASE_URL}/wing.jpg`,
    source: { kind: "remote", url: `${FIXTURE_BASE_URL}/wing.jpg` },
  },
  {
    id: "outdoor-tent",
    productName: "Tente dôme",
    label: "Tente en extérieur",
    description: "Valide l’isolation sur un arrière-plan naturel et chargé.",
    previewUrl: `${FIXTURE_BASE_URL}/tent4.jpg`,
    source: { kind: "remote", url: `${FIXTURE_BASE_URL}/tent4.jpg` },
  },
  {
    id: "dark-stove",
    productName: "Réchaud Jetboil",
    label: "Réchaud sombre",
    description: "Valide les contours d’un petit produit sombre et métallique.",
    previewUrl: `${FIXTURE_BASE_URL}/stove.jpg`,
    source: { kind: "remote", url: `${FIXTURE_BASE_URL}/stove.jpg` },
  },
  {
    id: "detailed-gps",
    productName: "GPS de randonnée",
    label: "GPS avec écran et marquages",
    description: "Valide la conservation des détails, boutons, textes et reflets.",
    previewUrl: `${FIXTURE_BASE_URL}/gps.jpg`,
    source: { kind: "remote", url: `${FIXTURE_BASE_URL}/gps.jpg` },
  },
  {
    id: "elongated-kayak",
    productName: "Kayak",
    label: "Kayak allongé",
    description: "Valide une silhouette large avec des éléments fins et saillants.",
    previewUrl: `${FIXTURE_BASE_URL}/kayak.jpg`,
    source: { kind: "remote", url: `${FIXTURE_BASE_URL}/kayak.jpg` },
  },
  {
    id: "partybox-cropped",
    productName: "Enceinte JBL PartyBox",
    label: "PartyBox cropée",
    description: "Valide le maintien du zoom et le détourage sous la poignée.",
    previewUrl: "/images/ai-image-benchmark/partybox-cropped.jpg",
    source: {
      kind: "public",
      path: "/images/ai-image-benchmark/partybox-cropped.jpg",
      mimeType: "image/jpeg",
    },
  },
  {
    id: "partybox-detail",
    productName: "Enceinte JBL PartyBox",
    label: "Détail de PartyBox",
    description: "Valide un cadrage très serré, sombre, avec un accent rouge.",
    previewUrl: "/images/ai-image-benchmark/partybox-detail.webp",
    source: {
      kind: "public",
      path: "/images/ai-image-benchmark/partybox-detail.webp",
      mimeType: "image/webp",
    },
  },
] as const;

export type ImageProcessingBenchmarkCase = (typeof IMAGE_PROCESSING_BENCHMARK_CASES)[number];

export const getImageProcessingBenchmarkCase = (fixtureId: string) =>
  IMAGE_PROCESSING_BENCHMARK_CASES.find((fixture) => fixture.id === fixtureId) ?? null;

/**
 * Model setups the benchmark can compare on the same images. Each selected
 * variant runs once per selected image.
 */
export const IMAGE_PROCESSING_BENCHMARK_VARIANTS = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    description: "Ancien modèle : fond chroma, puis notre détourage.",
    model: "gpt-image-2",
    nativeTransparency: false,
    selectedByDefault: true,
  },
  {
    id: "sunburst-2-6",
    label: "Sunburst 2.6",
    description: "Modèle par défaut : même chaîne, complexité medium.",
    model: "gpt-image-2.6-sunburst",
    nativeTransparency: false,
    selectedByDefault: true,
  },
  {
    id: "sunburst-2-6-transparent",
    label: "Sunburst 2.6 · fond transparent",
    description: "Le modèle rend lui-même le fond transparent, sans notre détourage.",
    model: "gpt-image-2.6-sunburst",
    nativeTransparency: true,
    selectedByDefault: false,
  },
  {
    id: "flare-2-6",
    label: "Flare 2.6",
    description: "Variante rapide de 2.6, même chaîne que Sunburst.",
    model: "gpt-image-2.6-flare",
    nativeTransparency: false,
    selectedByDefault: false,
  },
] as const;

export type ImageProcessingBenchmarkVariant = (typeof IMAGE_PROCESSING_BENCHMARK_VARIANTS)[number];

export const getImageProcessingBenchmarkVariant = (variantId: string) =>
  IMAGE_PROCESSING_BENCHMARK_VARIANTS.find((variant) => variant.id === variantId) ?? null;
