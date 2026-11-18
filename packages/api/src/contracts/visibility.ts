import { z } from "zod";

/**
 * The "Se faire connaître" guide (docs/product/visibilite-boutiques.md): the
 * few actions that bring a new store its first customers, and the visits its
 * shared links brought. A dashboard session only (`meta.actors`).
 */

/** The guide's steps, in the order the dashboard shows them. */
export const VISIBILITY_STEP_KEYS = ["share_contacts", "qr_poster", "google_business"] as const;
export type VisibilityStepKey = (typeof VISIBILITY_STEP_KEYS)[number];

/** `todo` has no row; `skipped` is "not for me" (no counter, no Google profile). */
export const VISIBILITY_STEP_STATUSES = ["todo", "done", "skipped"] as const;
export type VisibilityStepStatus = (typeof VISIBILITY_STEP_STATUSES)[number];

/**
 * Where a storefront visit came from, as the share tools mark their links
 * (`?via=`). A closed list: the storefront drops any other value. `copy` is
 * the link copied by hand, `google` the one pasted on the Google profile.
 */
export const VISIT_SOURCES = ["whatsapp", "sms", "email", "facebook", "copy", "qr", "google"] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];

/** The query parameter that carries a `VisitSource`; `ref` is the referral code's. */
export const VISIT_SOURCE_PARAM = "via";

export const visitSourceSchema = z.enum(VISIT_SOURCES);

/** The source a `via` value names, or null for anything else. */
export const parseVisitSource = (value: unknown): VisitSource | null => {
  const parsed = visitSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** How far back the guide counts visits. */
export const VISIBILITY_VISITS_WINDOW_DAYS = 28;

export const visibilityStepKeySchema = z.enum(VISIBILITY_STEP_KEYS);

export const visibilityStepSchema = z.object({
  key: visibilityStepKeySchema,
  status: z.enum(VISIBILITY_STEP_STATUSES),
  /** When it was marked done or skipped; null while it is to do. */
  decidedAt: z.date().nullable(),
});
export type VisibilityStep = z.infer<typeof visibilityStepSchema>;

export const getVisibilityInput = z.object({});

export const getVisibilityOutput = z.object({
  steps: z.array(visibilityStepSchema),
  /** Visits that came through a marked link, over the last `VISIBILITY_VISITS_WINDOW_DAYS` days. */
  visits: z.object({
    /** Distinct visits (storefront sessions), every source together. */
    total: z.number().int(),
    /** One entry per source that brought a visit, the most first. */
    bySource: z.array(z.object({ source: visitSourceSchema, visits: z.number().int() })),
  }),
});
export type VisibilityView = z.infer<typeof getVisibilityOutput>;

export const setVisibilityStepInput = z.object({
  step: visibilityStepKeySchema,
  /** `todo` reopens a step marked done or skipped. */
  status: z.enum(VISIBILITY_STEP_STATUSES),
});

export const setVisibilityStepOutput = visibilityStepSchema;
