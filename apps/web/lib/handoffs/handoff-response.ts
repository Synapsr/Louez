import { NextResponse } from "next/server";

import type { HandoffPorts } from "@louez/api/services/handoffs";

import { apiPorts } from "@/lib/api/ports";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

// What the handoff routes share (app/handoffs): the ports the provider flows
// take, and their same-origin redirects.

export const handoffPorts: HandoffPorts = {
  urls: apiPorts.urls,
  stripeConnect: apiPorts.stripeConnect,
  billing: apiPorts.billing,
};

/** A redirect, never stored: to a page of this app or to the provider. */
export const redirectTo = (location: string, status: 303 | 307) =>
  new NextResponse(null, {
    status,
    headers: { Location: location, "Cache-Control": "no-store" },
  });

/** Signed out: sign in first, then come back to `path`. */
export const toLogin = (path: string, status: 303 | 307) =>
  redirectTo(createLoginUrl(path, env.NEXT_PUBLIC_APP_URL), status);
