import type { NextRequest } from "next/server";

import { handoffPath } from "@louez/api/services/handoffs";

import { toLogin } from "@/lib/handoffs/handoff-response";

/** The link's page, signed out: sign in, then come back to it (handoff-response.ts). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  return toLogin(handoffPath((await params).token), 307);
}
