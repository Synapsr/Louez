import { NextResponse } from "next/server";

import type { HandoffPorts } from "@louez/api/services/handoffs";

import { apiPorts } from "@/lib/api/ports";
import { resumableHandoffPath } from "@/lib/handoffs/handoff-privacy";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

// What the handoff routes share (app/handoffs): the ports the provider flows
// take, and their redirects, which tell no other site where the user came from.

export const handoffPorts: HandoffPorts = {
  urls: apiPorts.urls,
  stripeConnect: apiPorts.stripeConnect,
  billing: apiPorts.billing,
};

/** A redirect, never stored and never sending a Referer: to a page of this app or to the provider. */
export const redirectTo = (location: string, status: 303 | 307) =>
  new NextResponse(null, {
    status,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

/**
 * The revision a handoff page's form posted: the step as the page showed
 * it. Null when there is none, as from a page served before revisions: the
 * click then decides nothing and the page shows the step again.
 */
export function postedRevision(form: FormData): number | null {
  const value = form.get("revision");
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  return Number(value);
}

/**
 * What an invitation's page posted of the invitation it showed (its
 * `invitationShown` digest). Null when there is none: the click decides
 * nothing and the page shows the invitation again.
 */
export function postedShown(form: FormData): string | null {
  const value = form.get("shown");
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** Where the login sends the user back: the handoff path kept in a cookie. */
export const HANDOFF_RESUME_PATH = "/handoffs/resume";
export const HANDOFF_RESUME_COOKIE = "louez_handoff_next";

/**
 * Signed out: sign in first, then come back to `path`. A return's path
 * holds its state, and an older link its secret, so the path waits in a
 * short-lived cookie scoped to the handoff routes, never in the login
 * page's URL, which the login page's analytics read.
 */
export function toLogin(path: string, status: 303 | 307) {
  const response = redirectTo(createLoginUrl(HANDOFF_RESUME_PATH, env.NEXT_PUBLIC_APP_URL), status);
  const kept = resumableHandoffPath(path);
  if (kept) {
    response.cookies.set(HANDOFF_RESUME_COOKIE, kept, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
      path: "/handoffs",
      maxAge: 3600,
    });
  }
  return response;
}
