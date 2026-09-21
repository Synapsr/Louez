import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, users } from "@louez/db";

import { OnlineStoreEditor } from "@/components/online-store/editor/online-store-editor";
import type { OnlineStoreEditorStore } from "@/components/online-store/util.online-store-form";
import { DashboardSaveShortcut } from "@/components/shared/dashboard-save-shortcut";
import { KeyboardShortcutsProvider } from "@/components/shared/keyboard-shortcuts-provider";
import { StoreProvider } from "@/contexts/store-context";
import { auth } from "@/lib/auth";
import { parseKeyboardShortcutOverrides } from "@/lib/keyboard-shortcuts";
import { getCurrentStore } from "@/lib/store-context";

// The session and the active store are read on every request.
export const instant = false;

/**
 * The online store editor takes the whole screen: it sits beside the
 * dashboard tree rather than inside it, the way the onboarding does, so the
 * sidebar layout never applies. The `(dashboard)` group layout above has
 * already checked the session and mounted the shared providers.
 */
export default async function OnlineStoreLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const store = await getCurrentStore();

  if (!store || !store.onboardingCompleted) {
    redirect("/onboarding");
  }

  const user = await db.query.users.findFirst({
    columns: { keyboardShortcuts: true },
    where: eq(users.id, session.user.id),
  });

  const settings = store.settings;
  const editorStore: OnlineStoreEditorStore = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    tagline: store.tagline,
    description: store.description,
    email: store.email,
    phone: store.phone,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    faviconUrl: store.faviconUrl,
    cgv: store.cgv,
    legalNotice: store.legalNotice,
    includeCgvInContract: store.includeCgvInContract,
    settings,
    theme: store.theme,
  };

  return (
    <KeyboardShortcutsProvider
      initialShortcuts={parseKeyboardShortcutOverrides(user?.keyboardShortcuts)}
    >
      <DashboardSaveShortcut />
      <StoreProvider
        role={store.role}
        storeId={store.id}
        currency={settings?.currency || "EUR"}
        storeSlug={store.slug}
        storeName={store.name}
        timezone={settings?.timezone}
      >
        <OnlineStoreEditor store={editorStore}>{children}</OnlineStoreEditor>
      </StoreProvider>
    </KeyboardShortcutsProvider>
  );
}
