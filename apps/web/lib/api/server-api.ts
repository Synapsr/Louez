import "server-only";

import { headers } from "next/headers";

import { appRouter } from "@louez/api/router";
import { createRouterClient } from "@orpc/server";

import { apiPorts } from "@/lib/api/ports";

/**
 * The agent-ready procedures for a server component, called as the signed-in
 * user of this request (their session cookie, their current store), as the
 * dashboard calls them over RPC. Domains join as they migrate.
 */
export async function serverApi() {
  const context = {
    headers: new Headers(await headers()),
    transport: "rpc" as const,
    ports: apiPorts,
  };
  return {
    categories: createRouterClient(appRouter.dashboard.categories, {
      context,
      path: ["dashboard", "categories"],
    }),
    products: createRouterClient(appRouter.dashboard.products, {
      context,
      path: ["dashboard", "products"],
    }),
    reservations: createRouterClient(appRouter.dashboard.reservations, {
      context,
      path: ["dashboard", "reservations"],
    }),
    settings: createRouterClient(appRouter.dashboard.settings, {
      context,
      path: ["dashboard", "settings"],
    }),
    stores: createRouterClient(appRouter.dashboard.stores, {
      context,
      path: ["dashboard", "stores"],
    }),
  };
}
