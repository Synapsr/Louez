/**
 * Whether a store gets « Être trouvé par les IA »: its llms.txt files, and the
 * AI section of « Se faire connaître » (readiness, visits from assistants,
 * crawler reads). Every store gets it for now; the cofounders may sell it
 * later as a plan feature or a paid add-on.
 *
 * The one place it is decided: the storefront's llms.txt routes and the
 * dashboard page call it, and the API asks it through `apiPorts.aiVisibility`.
 * To gate it, change this function only, for instance:
 *
 *   const plan = await getStorePlan(store.id);   // @/lib/plan-limits
 *   return plan.features.aiVisibility;           // a new PlanFeatures flag
 *
 * Left out of any gate on purpose: the structured data of every page (JSON-LD,
 * titles, sitemap), robots.txt welcoming AI crawlers, and the counting of AI
 * visits and reads, so a store that buys it later sees its past figures.
 */
export async function canUseAiVisibility(_store: { id: string }): Promise<boolean> {
  return true;
}
