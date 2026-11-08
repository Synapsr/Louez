import { z } from "zod";

/**
 * The links of a record, as every procedure that returns one gives them:
 * absolute URLs on this deployment, built by platform/links.ts. An agent
 * gives these to the user instead of guessing an address.
 */
export const resourceLinksSchema = z
  .object({
    dashboard: z.string().describe("The record's page in the Louez dashboard."),
    storefront: z
      .string()
      .optional()
      .describe(
        "The record's public page on the store's online store; absent when the public cannot see it.",
      ),
  })
  .describe(
    "Links to give the user: share these URLs as they are, never build or guess another one.",
  );
export type ResourceLinks = z.infer<typeof resourceLinksSchema>;
