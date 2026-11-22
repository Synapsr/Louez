import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { LogoIcon } from "@louez/ui";

import { DemoLauncher } from "@/components/demo/demo-launcher";
import { auth } from "@/lib/auth";
import { isDemoOwnerEmail } from "@/lib/demo/constants";
import { DEMO_COOKIE, parseDemoSessionCookie } from "@/lib/demo/demo-session-cookie";
import { findLiveDemoStore } from "@/lib/demo/start-demo";
import { DEMO_VERTICALS, isDemoVerticalKey } from "@/lib/demo/verticals";
import { isStandaloneMode } from "@/lib/deployment";

// Reads the session and the demo cookie: the page is rendered per request.
export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * One-click entry to a demo store: /demo/ski, /demo/velo, /demo/evenementiel.
 * The page opens the store from the browser (DemoLauncher), so a link
 * followed by a crawler creates nothing. A visitor already in this trade's
 * demo goes straight back to it.
 */
export default async function DemoEntryPage({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  if (isStandaloneMode() || !isDemoVerticalKey(vertical)) notFound();

  const session = await auth();
  if (session?.user && isDemoOwnerEmail(session.user.email)) {
    const demo = parseDemoSessionCookie((await cookies()).get(DEMO_COOKIE)?.value);
    if (demo?.vertical === vertical) {
      const live = await findLiveDemoStore({ userId: session.user.id, storeId: demo.storeId });
      if (live) redirect("/dashboard");
    }
  }

  const t = await getTranslations("demo.launcher");
  const trade = DEMO_VERTICALS[vertical];
  // A signed-in owner would lose their session: they choose, nothing starts by itself.
  const signedInToRealAccount = Boolean(session?.user && !isDemoOwnerEmail(session.user.email));

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
        <LogoIcon size={36} />
        <p className="mt-6 text-sm font-medium text-muted-foreground">{trade.label}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{trade.store.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("subtitle")}</p>
        <DemoLauncher
          vertical={vertical}
          autoStart={!signedInToRealAccount}
          signedIn={signedInToRealAccount}
        />
      </div>
    </main>
  );
}
