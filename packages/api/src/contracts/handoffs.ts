import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * Handoffs: a step only the human can take (Stripe's identity checks, a
 * billing card, approving a team invitation, creating a store an agent may
 * not create itself), started by an agent. The agent gets a short-lived link
 * to a Louez page, gives it to the user, then reads the handoff until it is done.
 */

export const HANDOFF_KINDS = [
  "stripe_connect_onboarding",
  "stripe_dashboard",
  "billing_card_setup",
  "team_invitation",
  "store_creation",
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

/**
 * `pending`: the link is out, the user has not continued to the provider.
 * `opened`: the user continued, the provider's flow is not finished.
 * `expired`: the link ran out before the step was done; ask for a new one.
 * `completed`, `failed`: the end.
 */
export const HANDOFF_STATUSES = ["pending", "opened", "completed", "expired", "failed"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

/** How long a link works. */
export const HANDOFF_TTL_HOURS = 24;

export const handoffSchema = z.object({
  id: z.string(),
  kind: z.enum(HANDOFF_KINDS),
  status: z.enum(HANDOFF_STATUSES),
  createdAt: z.date(),
  /** When the current link stops working. */
  expiresAt: z.date(),
  openedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  /**
   * The user came back from the provider, which had not confirmed the step
   * yet (a card Stripe still checks): asking the provider again, with
   * handoffs_refresh, may complete it.
   */
  confirming: z.boolean(),
  /** One sentence for the user, about where the step stands. */
  summary: z.string(),
  /** The invitation an owner approves or declines (`team_invitation`); null for the other kinds. */
  invitation: z
    .object({
      email: z.string(),
      role: z.literal("member"),
      /** The address had a Louez account when asked: approving adds them at once. */
      joinsAtOnce: z.boolean(),
    })
    .nullable(),
  /**
   * The store the step created (`store_creation`, once completed): pass it
   * as `storeId` to the other tools. Null otherwise.
   */
  storeId: z.string().nullable(),
  links: resourceLinksSchema,
});
export type HandoffView = z.infer<typeof handoffSchema>;

/** A new link: shown once, never stored in clear, never replayed. */
export const handoffLinkSchema = z.object({
  handoff: handoffSchema,
  url: z
    .string()
    .describe(
      "The link to give the user, as is. It works once signed in to Louez as this user, and expires at handoff.expiresAt.",
    ),
});
export type HandoffLink = z.infer<typeof handoffLinkSchema>;

export const getHandoffInput = z.object({ id: z.string().min(1).max(21) });

/** The dashboard completes a store creation it was handed, with the store it created. */
export const completeStoreCreationInput = z.object({
  id: z.string().min(1).max(21),
  storeId: z.string().length(21),
});
export const completeStoreCreationOutput = z.object({
  /** False when it changed nothing: another user's step, finished or replaced, or not their store. */
  completed: z.boolean(),
});
export const getHandoffOutput = handoffSchema;
export const refreshHandoffInput = getHandoffInput;
export const refreshHandoffOutput = handoffSchema;

const FAILURE_MESSAGES: Record<string, string> = {
  provider_failed: "The provider's page could not be opened. Ask for a new link and try again.",
  not_available: "This step is not available for the store anymore.",
  connection_revoked:
    "The agent connection that asked for this step was revoked: its link no longer works.",
  declined: "The user declined this invitation.",
  request_changed:
    "The address got a Louez account, a membership or an invitation since the request: ask again for an up-to-date approval.",
  limit_reached: "The store's plan has no seat left for a member.",
  email_limit: "The store sent too many invitation e-mails today. Try again tomorrow.",
  store_email_required:
    "Stripe needs an email for the account: set the store's contact email (settings_update_store_info), then ask for a new link.",
};

export const handoffFailureMessage = (code: string) =>
  FAILURE_MESSAGES[code] ?? "The step could not be finished. Ask for a new link and try again.";

export const handoffErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "HANDOFF_NOT_FOUND", {
      message: `No handoff ${id} in this store.`,
      details: { id },
    }),
};
