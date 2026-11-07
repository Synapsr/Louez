/**
 * What the agent-ready API takes from the app that serves it: only what is
 * bound to Next.js or to the billing service. Business code (Stripe, e-mail,
 * storage…) lives in the package as services and adapters, never here.
 *
 * Every handler of the app (RPC, OpenAPI, MCP) builds the same object and puts
 * it in the context as `ports`.
 */
export interface ApiPorts {
  /** Features of the plan in force for the store (billing owns plans). */
  planFeatures: (storeId: string) => Promise<{ apiAccess: boolean }>;
}
