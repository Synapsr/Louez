import { isLocale, defaultLocale } from "@/i18n/config";
import { cookies, headers } from "next/headers";
import { DEMO_LOCALE_HEADER, DEMO_ROUTE_HEADER } from "@/lib/landing-demos/policy";
import { isDemoRequest } from "@/lib/demo/demo-request";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale } from "next-intl/server";

import { NuqsAdapter } from "nuqs/adapters/next/app";

import { AnchoredToastProvider, ToastProvider } from "@louez/ui";

import { EvlogProvider } from "@/components/evlog-provider";
import { InstanceProvider } from "@/components/instance-provider";
import { MarketingTrackers } from "@/components/marketing-trackers";
import { PostHogBootstrap } from "@/components/shared/posthog-bootstrap";
import { PublicEnvProvider } from "@/components/shared/public-env-provider";

import { getPublicEnv } from "@/env";
import { getInstanceConfig } from "@/lib/deployment";
import { ORPCProvider } from "@/lib/orpc/provider";
import { NO_INDEX_ROBOTS, isSearchIndexingEnabled } from "@/lib/search-indexing";
import { clientTrackingFor } from "@/lib/util.client-tracking";

// Import translations directly since this is a root layout without NextIntlProvider
import messages from "@/messages/fr.json";

import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const baseMetadata: Metadata = {
  title: {
    default: messages.app.name,
    template: `%s | ${messages.app.name}`,
  },
  description: messages.app.description,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.svg",
  },
};

// Read at request time, so the prebuilt image honors LOUEZ_SEARCH_INDEXING. A page
// that sets its own robots (lib/seo.tsx) applies the switch itself.
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (isSearchIndexingEnabled()) return baseMetadata;
  return { ...baseMetadata, robots: NO_INDEX_ROBOTS };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Instance capabilities are injected into the prebuilt Docker image at
  // runtime. Without this request boundary, Cache Components can freeze the
  // build host's default LOUEZ_MODE into the static shell and hydrate the
  // client with the wrong deployment mode.
  await connection();
  const requestHeaders = await headers();
  const isPublicDemo = requestHeaders.get(DEMO_ROUTE_HEADER) === "1";
  const inDemoStore = await isDemoRequest({ headers: requestHeaders, cookies: await cookies() });
  const tracking = clientTrackingFor({ headers: requestHeaders, isPublicDemo, inDemoStore });
  const instanceConfig = getInstanceConfig();
  const publicEnv = getPublicEnv();
  // Drives the document language for screen readers and translation tools.
  const demoLocale = requestHeaders.get(DEMO_LOCALE_HEADER);
  const locale = isPublicDemo
    ? isLocale(demoLocale)
      ? demoLocale
      : defaultLocale
    : await getLocale();

  const app = (
    <ORPCProvider>
      <ToastProvider position="top-center">
        <AnchoredToastProvider>{children}</AnchoredToastProvider>
      </ToastProvider>
    </ORPCProvider>
  );

  return (
    <>
      {/* {process.env.NODE_ENV === 'development' && <Agentation />} */}

      <html lang={locale} suppressHydrationWarning className="overscroll-none">
        {tracking.marketingTrackers && <MarketingTrackers />}

        <head>
          <link
            rel="preload"
            href="/fonts/Inter-4.1/web/InterVariable.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        </head>
        <body className="font-sans antialiased">
          <PublicEnvProvider config={publicEnv}>
            {isPublicDemo ? (
              children
            ) : (
              <>
                {tracking.productAnalytics && <PostHogBootstrap />}
                <InstanceProvider config={instanceConfig}>
                  <NuqsAdapter>
                    {tracking.productAnalytics ? <EvlogProvider>{app}</EvlogProvider> : app}
                  </NuqsAdapter>
                </InstanceProvider>
              </>
            )}
          </PublicEnvProvider>
        </body>
      </html>
    </>
  );
}
