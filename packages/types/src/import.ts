// ============================================================================
// Data import
// ============================================================================

export const IMPORT_ENTITY_TYPES = ["customers", "products"] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export const IMPORT_RUN_STATUSES = [
  "draft",
  "ready",
  "running",
  "completed",
  "failed",
  "reverted",
] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const IMPORT_ROW_STATUSES = ["pending", "created", "updated", "skipped", "error"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_DUPLICATE_STRATEGIES = ["fill_empty", "overwrite", "skip"] as const;
export type ImportDuplicateStrategy = (typeof IMPORT_DUPLICATE_STRATEGIES)[number];

/** Source column → target. `field:<name>` is a native field, `custom:<definitionId>` a custom one. */
export type ImportColumnMapping = Record<string, string | null>;

export interface ImportRunCounts {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}
