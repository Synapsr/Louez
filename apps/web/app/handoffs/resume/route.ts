import type { NextRequest } from "next/server";

import { resumableHandoffPath } from "@/lib/handoffs/handoff-privacy";
import { HANDOFF_RESUME_COOKIE, redirectTo } from "@/lib/handoffs/handoff-response";

/**
 * Back from the login: the handoff path the user was on, kept in a cookie so
 * its secret never reached the login page's URL. Only a handoff path, once.
 */
export function GET(request: NextRequest) {
  const path = resumableHandoffPath(request.cookies.get(HANDOFF_RESUME_COOKIE)?.value);
  const response = redirectTo(path ?? "/dashboard", 307);
  response.cookies.delete({ name: HANDOFF_RESUME_COOKIE, path: "/handoffs" });
  return response;
}
