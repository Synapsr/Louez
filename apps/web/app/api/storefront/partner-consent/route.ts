import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { parsePartnerCode } from "@louez/api/contracts/partners";
import { findActivePartnerByCode } from "@louez/api/services/partners";

import {
  PARTNER_COOKIE,
  PARTNER_COOKIE_MAX_AGE,
  encodePartnerCookie,
} from "@/lib/partners/partner-cookie";
import { isLoopbackHost } from "@/lib/util.host";

const consentSchema = z.object({
  storeId: z.string().min(1).max(21),
  code: z.string().min(1).max(60),
});

/**
 * The customer agreed, on a storefront page opened by a partner's link, to
 * credit that partner (docs/product/liens-partenaires.md): the storefront
 * remembers it for the attribution window, until another partner's link is
 * accepted. Nothing is stored for an unknown or archived code.
 *
 * JSON from the storefront's own pages only: another site cannot send JSON
 * here without a preflight this route never answers, so it cannot set the
 * cookie in a visitor's browser (no partner credited behind their back).
 * Answered as a plain request rather than a Server Action, whose refresh
 * would put the link's parameter back in the address bar.
 */
export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const parsed = consentSchema.safeParse(await request.json().catch(() => null));
  const code = parsed.success ? parsePartnerCode(parsed.data.code) : null;
  if (!parsed.success || !code) return NextResponse.json({ ok: false }, { status: 400 });

  const partner = await findActivePartnerByCode(parsed.data.storeId, code);
  if (!partner) return NextResponse.json({ ok: false }, { status: 404 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PARTNER_COOKIE, encodePartnerCookie(parsed.data.storeId, code), {
    maxAge: PARTNER_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: !isLoopbackHost((request.headers.get("host") ?? "").split(":")[0]),
  });
  return response;
}
