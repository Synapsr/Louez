import type { EmbedSnippetVariant } from "@/lib/embed/util.embed-snippet";

/** How the merchant page wires the widget up. */
export type EmbedIntegrationId = EmbedSnippetVariant | "standalone";

/** Where the widget sits on the merchant page. */
export type EmbedPlacementId = "full" | "sidebar" | "hero";

/** Colour scheme of the simulated merchant site, not of the storefront. */
export type EmbedHostThemeId = "light" | "dark";

interface PlaygroundOption<Id extends string> {
  id: Id;
  label: string;
  description: string;
}

export const EMBED_INTEGRATIONS: readonly PlaygroundOption<EmbedIntegrationId>[] = [
  {
    id: "auto",
    label: "Iframe + script",
    description: "Le code officiel : l'iframe suit la hauteur du widget.",
  },
  {
    id: "fixed",
    label: "Iframe seule",
    description: "Sans le script : hauteur figée, du vide sous le widget replié.",
  },
  {
    id: "standalone",
    label: "Page directe",
    description: "L'URL /embed ouverte telle quelle, sans site hôte.",
  },
];

export const EMBED_PLACEMENTS: readonly PlaygroundOption<EmbedPlacementId>[] = [
  {
    id: "full",
    label: "Pleine largeur",
    description: "Dans le corps de page, centré.",
  },
  {
    id: "sidebar",
    label: "Colonne latérale",
    description: "Dans une colonne de 320 px.",
  },
  {
    id: "hero",
    label: "Bandeau héro",
    description: "Posé sur une bannière, comme sur une page d'accueil.",
  },
];

export interface ViewportPreset {
  id: string;
  label: string;
  /** `null` renders at the width of the preview pane. */
  width: number | null;
}

export const EMBED_VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: "mobile", label: "Mobile", width: 390 },
  { id: "tablet", label: "Tablette", width: 768 },
  { id: "laptop", label: "Portable", width: 1280 },
  { id: "fluid", label: "Fluide", width: null },
];

export const EMBED_VIEWPORT_MIN_WIDTH = 320;
export const EMBED_VIEWPORT_MAX_WIDTH = 1600;

/** The widget lands on someone else's site: the mock deliberately ignores our tokens. */
export const EMBED_HOST_THEME_CLASSNAMES: Record<EmbedHostThemeId, string> = {
  light: "bg-white text-neutral-900",
  dark: "bg-neutral-900 text-neutral-100",
};
