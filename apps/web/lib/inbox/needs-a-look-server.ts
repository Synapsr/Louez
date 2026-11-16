import "server-only";

import { serverApi } from "@/lib/api/server-api";
import { log } from "@/lib/evlog";

import { loadNeedsALook, type NeedsALook } from "./needs-a-look";

/**
 * What needs a look, for the signed-in member of this request, or null when
 * the inbox cannot be read now: the home's line and the sidebar's dot then
 * stay quiet rather than take the dashboard down. One filtered read; `limit`
 * 1 when only whether anything waits matters (the sidebar).
 */
export async function readNeedsALook(limit?: number): Promise<NeedsALook | null> {
  try {
    return await loadNeedsALook((await serverApi()).inbox, limit);
  } catch (error) {
    log.error({
      needsALook: {
        issue: "read_failed",
        error: error instanceof Error ? error.name : typeof error,
      },
    });
    return null;
  }
}
