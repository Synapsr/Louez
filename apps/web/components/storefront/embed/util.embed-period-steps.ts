import type { RentalPeriodField } from "@/components/storefront/date-picker/core/types";

/** One half of one field: the four things a customer can edit. */
export type EmbedPeriodStep = "startDate" | "startTime" | "endDate" | "endTime";

export type EmbedPeriodPart = "date" | "time";

export const EMBED_PERIOD_STEPS = ["startDate", "startTime", "endDate", "endTime"] as const;

export const toEmbedPeriodStep = (
  field: RentalPeriodField,
  part: EmbedPeriodPart,
): EmbedPeriodStep => (part === "date" ? `${field}Date` : `${field}Time`);

export const embedStepField = (step: EmbedPeriodStep): RentalPeriodField =>
  step.startsWith("start") ? "start" : "end";

export const embedStepPart = (step: EmbedPeriodStep): EmbedPeriodPart =>
  step.endsWith("Date") ? "date" : "time";

/** The step after `step` in the guided order, or null after the return time. */
export const nextEmbedPeriodStep = (step: EmbedPeriodStep): EmbedPeriodStep | null =>
  EMBED_PERIOD_STEPS[EMBED_PERIOD_STEPS.indexOf(step) + 1] ?? null;

export interface EmbedPeriodEditing {
  /** The half whose editor is open, or null when the panel is folded. */
  active: EmbedPeriodStep | null;
  /** Whether a pick hands over to the next half (the first fill only). */
  chaining: boolean;
}

export const FOLDED_EMBED_PERIOD: EmbedPeriodEditing = { active: null, chaining: false };

/**
 * A tap on a half: folds it when it is already open, else opens it. The
 * guided chain only starts while the widget holds no dates yet; once a
 * period exists, a tap edits that half alone.
 */
export const resolveEmbedPeriodTap = (
  editing: EmbedPeriodEditing,
  tapped: EmbedPeriodStep,
  hasDates: boolean,
): EmbedPeriodEditing => {
  if (editing.active === tapped) return FOLDED_EMBED_PERIOD;
  return { active: tapped, chaining: !hasDates };
};

/** A pick in the open half: the next half while chaining, else fold. */
export const resolveEmbedPeriodPick = (editing: EmbedPeriodEditing): EmbedPeriodEditing => {
  if (!editing.active || !editing.chaining) return FOLDED_EMBED_PERIOD;
  const next = nextEmbedPeriodStep(editing.active);
  return next ? { active: next, chaining: true } : FOLDED_EMBED_PERIOD;
};
