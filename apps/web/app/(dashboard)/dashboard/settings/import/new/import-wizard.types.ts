import type { DelimitedTable } from "@louez/utils";

export type ImportOrigin = "file" | "paste";

/** What the person has loaded, before anything is sent. */
export interface ImportSourceData {
  origin: ImportOrigin;
  fileName: string | null;
  table: DelimitedTable;
}

export const IMPORT_STEP_IDS = ["source", "file", "columns", "review", "run"] as const;
export type ImportStepId = (typeof IMPORT_STEP_IDS)[number];
