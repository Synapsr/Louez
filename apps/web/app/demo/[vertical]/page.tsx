import type { Metadata } from "next";
import type { CSSProperties } from "react";
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
import { getStorefrontUrl } from "@/lib/storefront-url";

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
      if (live) redirect(getStorefrontUrl(live.slug));
    }
  }

  const trade = DEMO_VERTICALS[vertical];
  // A signed-in owner would lose their session: they choose, nothing starts by itself.
  const signedInToRealAccount = Boolean(session?.user && !isDemoOwnerEmail(session.user.email));
  const autoStart = !signedInToRealAccount;

  return (
    <main
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6"
      style={{ "--demo-accent": trade.store.primaryColor } as CSSProperties}
    >
      {autoStart ? (
        // Asks for the store as soon as the HTML arrives, before the page's
        // scripts: DemoLauncher takes this answer over. A crawler that runs no
        // script, or follows no form, opens nothing.
        <script dangerouslySetInnerHTML={{ __html: earlyStartScript(vertical) }} />
      ) : null}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_40%,color-mix(in_srgb,var(--demo-accent)_12%,transparent),transparent)]"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <LogoIcon size={28} />
        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-balance">
          {trade.store.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{trade.label}</p>
        <DemoLauncher vertical={vertical} autoStart={autoStart} signedIn={signedInToRealAccount} />
      </div>
    </main>
  );
}

/**
 * The request DemoLauncher would send, sent by the HTML itself, which also
 * goes to the storefront as soon as the store is ready: neither waits for the
 * page's scripts. An answer that is not a success is left to DemoLauncher.
 */
const earlyStartScript = (vertical: string): string =>
  `window.__louezDemoStart=fetch("/api/demo/start",{method:"POST",headers:{"content-type":"application/json"},body:${JSON.stringify(
    JSON.stringify({ vertical }),
  )}}).then(function(r){return r.json().catch(function(){return {}}).then(function(b){return {ok:r.ok,body:b}})}).catch(function(){return {ok:false,body:{}}}).then(function(a){if(a.ok&&a.body.redirectTo){window.__louezDemoNavigating=true;document.documentElement.dataset.demoReady="";setTimeout(function(){location.assign(a.body.redirectTo)},120)}return a});`;
