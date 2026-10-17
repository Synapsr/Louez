import { previewSchema } from "@louez/voice/protocol";
import { getStorePlan } from "@/lib/plan-limits";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";
import { isLiveConfigured } from "@/lib/voice/config";
import { allowVoicePreview, fetchVoicePreview } from "@/lib/voice/preview";

export const maxDuration = 30;

// Dashboard only. A fixed sample from the same GPT-Live model/preset used on
// calls; the OpenAI key and synthesis prompt never reach the browser.
export async function GET(req: Request) {
  const store = await getCurrentStore();
  if (!store) return new Response("Unauthorized", { status: 401 });
  if (
    !(await currentUserHasPermission("manage_settings")) ||
    !(await getStorePlan(store.id)).features.aiPhone
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const parsed = previewSchema.safeParse({
    voiceId: params.get("voiceId"),
    language: params.get("language") ?? "en",
  });
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  if (!isLiveConfigured()) return new Response("Preview unavailable", { status: 503 });
  if (!allowVoicePreview(store.id))
    return new Response("Too many previews", { status: 429, headers: { "retry-after": "60" } });
  try {
    return await fetchVoicePreview(parsed.data);
  } catch {
    return new Response("Preview unavailable", { status: 503 });
  }
}
