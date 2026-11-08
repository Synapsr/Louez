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
