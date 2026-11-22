import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isTrustedAuthOrigin } from "@louez/auth";

import { DEMO_STEPS } from "@/lib/demo/constants";
import { captureDemoEvent, demoAnalyticsEvents } from "@/lib/demo/demo-analytics";
import { DEMO_COOKIE, parseDemoSessionCookie } from "@/lib/demo/demo-session-cookie";

const bodySchema = z.object({
  step: z.enum(DEMO_STEPS),
  /** The guide's step, for `guide_step_clicked`. */
  guideStep: z
    .string()
    .max(32)
    .regex(/^[a-z_]+$/)
    .optional(),
});

/**
 * A step of the visitor's demo (`demo_step`), sent by the banner and the
 * guide. Only a browser holding a demo cookie counts: anything else is
 * answered and dropped.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !(await isTrustedAuthOrigin(origin))) {
    return new NextResponse(null, { status: 403 });
  }
  const demo = parseDemoSessionCookie((await cookies()).get(DEMO_COOKIE)?.value);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (demo && parsed.success) {
    await captureDemoEvent({
      event: demoAnalyticsEvents.step,
      vertical: demo.vertical,
      visitorId: demo.visitorId,
      headers: request.headers,
      properties: { step: parsed.data.step, guide_step: parsed.data.guideStep ?? null },
    });
  }
  return new NextResponse(null, { status: 204 });
}
