import { z } from "zod";

import { resourceLinksSchema, type ResourceLinks } from "@louez/api/contracts/links";

/** The line a tool's text answer gives its links on, for a model to pass on as they are. */
export function linksLine(links: ResourceLinks, label = "Links to give the user"): string {
  const parts = [`dashboard ${links.dashboard}`];
  if (links.storefront) parts.push(`storefront ${links.storefront}`);
  return `${label}: ${parts.join(", ")}.`;
}

/** The links of a tool's structured output, when it has some at its top level. */
export function outputLinks(output: Record<string, unknown>): ResourceLinks | null {
  const parsed = resourceLinksSchema.safeParse(output.links);
  return parsed.success ? parsed.data : null;
}

/** A handoff's link as a tool's JSON output holds it (dates as ISO strings). */
const handoffOutput = z.object({
  url: z.string(),
  handoff: z.object({ id: z.string(), expiresAt: z.string() }),
});

/**
 * The line of a handoff's link (a step only the user can take), when the
 * output is one: the URL to send them, and the id to poll.
 */
export function handoffLine(output: Record<string, unknown>): string | null {
  const parsed = handoffOutput.safeParse(output);
  if (!parsed.success) return null;
  const { url, handoff } = parsed.data;
  return `Link to send the user (only they can finish this step): ${url} . It expires at ${handoff.expiresAt}. Then call handoffs_get with id ${handoff.id} until it is completed.`;
}
