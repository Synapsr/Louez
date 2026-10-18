import { asSchema, type ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { db, storeLocations } from "@louez/db";
import type { SessionConfig } from "@louez/voice/protocol";
import { buildProductGuidance, buildStoreCatalog } from "@/lib/ai/product-guidance";
import {
  buildLivePhoneGreeting,
  buildLivePhoneInstructions,
  buildPhoneSystemPrompt,
} from "@/lib/ai/phone/system-prompt";
import { createPhoneTools } from "@/lib/ai/phone/tools";
import { loadCallStore } from "@/lib/ai/phone/webhook";
import { getLiveModel, getPhoneBackendModel, resolveVoiceId } from "@/lib/voice/config";

export type CallStore = NonNullable<Awaited<ReturnType<typeof loadCallStore>>>;

export function toolsForCall(
  store: CallStore,
  conversationId: string,
  callerPhone: string,
): ToolSet {
  const settings = store.aiPhoneSettings;
  return createPhoneTools({
    storeId: store.id,
    storeName: store.name,
    storeSlug: store.slug,
    conversationId,
    callerPhone,
    language: settings?.language ?? "en",
    canTakeReservations: settings?.canTakeReservations ?? false,
    transferNumber: settings?.transferNumber?.trim() || null,
  });
}

export async function createLiveConfig(
  store: CallStore,
  conversationId: string,
  callerPhone: string,
  maxSeconds: number,
): Promise<SessionConfig> {
  const settings = store.aiPhoneSettings;
  if (!settings) throw new Error("Phone settings missing");
  const [catalog, productGuidance, locations] = await Promise.all([
    buildStoreCatalog(store.id),
    buildProductGuidance(store.id),
    db
      .select({ name: storeLocations.name, city: storeLocations.city })
      .from(storeLocations)
      .where(and(eq(storeLocations.storeId, store.id), eq(storeLocations.isActive, true)))
      .limit(20),
  ]);
  const storeContext = store.aiAdvisorSettings?.storeContext ?? null;
  const backendInstructions = buildPhoneSystemPrompt({
    storeName: store.name,
    storeDescription: store.description,
    language: settings.language,
    currency: store.settings?.currency ?? "EUR",
    canTakeReservations: settings.canTakeReservations,
    answerMode: settings.answerMode,
    storeEmail: store.email,
    storePhone: store.phone,
    storeAddress: store.address,
    businessHours: store.settings?.businessHours ?? null,
    timezone: store.settings?.timezone ?? null,
    deliveryEnabled: store.settings?.delivery?.enabled ?? null,
    deliveryMode: store.settings?.delivery?.mode ?? null,
    pickupLocations: locations,
    catalog,
    collectedFacts: null,
    storeContext,
    productGuidance,
    today: new Intl.DateTimeFormat("en-CA", {
      timeZone: store.settings?.timezone || "Europe/Paris",
    }).format(new Date()),
  });
  const tools = await Promise.all(
    Object.entries(toolsForCall(store, conversationId, callerPhone)).map(async ([name, tool]) => {
      const parameters = await asSchema(tool.inputSchema).jsonSchema;
      return {
        type: "function" as const,
        name,
        description: tool.description ?? name,
        parameters,
        strict: false as const,
      };
    }),
  );
  return {
    model: getLiveModel(),
    backendModel: getPhoneBackendModel(),
    voice: resolveVoiceId(settings.language, settings.voice),
    maxSeconds,
    instructions: buildLivePhoneInstructions({
      storeName: store.name,
      language: settings.language,
      answerMode: settings.answerMode,
      canTakeReservations: settings.canTakeReservations,
      storeContext,
    }),
    backendInstructions,
    tools,
    greeting: buildLivePhoneGreeting(settings.language, store.name, settings.greeting),
  };
}
