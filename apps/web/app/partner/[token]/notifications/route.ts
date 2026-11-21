import { NextResponse, type NextRequest } from "next/server";

import { partnerNotificationsSchema } from "@louez/api/contracts/partners";
import { updatePartnerNotifications } from "@louez/api/services/partner-space";

/**
 * A partner's choice of e-mails, from its space (Liens partenaires). The
 * space's secret is the only key, as for reading it. JSON from the space's own
 * page only: another site cannot send JSON here without a preflight this
 * route never answers.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const parsed = partnerNotificationsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const { token } = await params;
  const saved = await updatePartnerNotifications(token, parsed.data);
  return NextResponse.json({ ok: saved }, { status: saved ? 200 : 404 });
}
