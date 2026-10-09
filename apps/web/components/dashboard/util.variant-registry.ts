import { findMatchingVariant, getVariantAxisIdentity } from "@louez/utils";

import type { ResolvedVariantPreset } from "@/lib/variant-presets";

export interface VariantCatalogDefinition {
  id: string;
  key: string;
  label: string;
  kind: "size" | "color" | "custom";
  isActive: boolean;
  values: Array<{ label: string; colorHex: string | null }>;
}

export interface VariantRegistryEntry {
  /** Product storage key, which can differ from the shared catalog key. */
  key: string;
  catalogKey: string;
  label: string;
  kind: "size" | "color" | "custom";
  colorIndex: number;
  definitionId?: string;
  values: Array<{ label: string; colorHex: string | null }>;
}

export const buildVariantRegistry = (
  axes: readonly { key: string; label: string }[],
  definitions: readonly VariantCatalogDefinition[],
  presets: readonly ResolvedVariantPreset[],
): VariantRegistryEntry[] => {
  const entries: VariantRegistryEntry[] = [];
  const included = new Set<string>();
  const addEntry = (entry: Omit<VariantRegistryEntry, "colorIndex">) => {
    const identity = getVariantAxisIdentity(entry.key);
    if (included.has(identity)) return;
    included.add(identity);
    entries.push({ ...entry, colorIndex: entries.length });
  };

  // A product keeps editing the axes it already carries, even when the
  // catalog no longer offers that variant to new products.
  for (const axis of axes) {
    const definition = findMatchingVariant(axis.key, definitions);
    const preset = findMatchingVariant(axis.key, presets);
    addEntry({
      key: axis.key,
      catalogKey: definition?.key ?? preset?.key ?? axis.key,
      label: definition?.label ?? preset?.label ?? axis.label,
      kind: definition?.kind ?? preset?.kind ?? "custom",
      definitionId: definition?.id,
      values: definition?.values ?? preset?.values ?? [],
    });
  }

  for (const definition of definitions) {
    if (!definition.isActive) continue;
    addEntry({
      key: definition.key,
      catalogKey: definition.key,
      label: definition.label,
      kind: definition.kind,
      definitionId: definition.id,
      values: definition.values,
    });
  }

  for (const preset of presets) {
    if (!preset.defaultActive || findMatchingVariant(preset.key, definitions)) continue;
    addEntry({
      key: preset.key,
      catalogKey: preset.key,
      label: preset.label,
      kind: preset.kind,
      values: preset.values,
    });
  }

  return entries;
};
