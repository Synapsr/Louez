import type { Metadata } from "next";
import { connection } from "next/server";
import Script from "next/script";
import { getLocale } from "next-intl/server";

import { NuqsAdapter } from "nuqs/adapters/next/app";

import { AnchoredToastProvider, ToastProvider } from "@louez/ui";

import { EvlogProvider } from "@/components/evlog-provider";
import { InstanceProvider } from "@/components/instance-provider";
import { PostHogBootstrap } from "@/components/shared/posthog-bootstrap";
import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { UmamiAnalytics } from "@/components/umami-analytics";

import { env, getPublicEnv } from "@/env";
import { getInstanceConfig } from "@/lib/deployment";
import { ORPCProvider } from "@/lib/orpc/provider";

// Import translations directly since this is a root layout without NextIntlProvider
import messages from "@/messages/fr.json";

import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
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
  const instanceConfig = getInstanceConfig();
  const publicEnv = getPublicEnv();
  // Drives the document language for screen readers and translation tools.
  const locale = await getLocale();

  return (
    <>
      {/* {process.env.NODE_ENV === 'development' && <Agentation />} */}

      <html lang={locale} suppressHydrationWarning className="overscroll-none">
        <UmamiAnalytics />

        {env.NEXT_PUBLIC_FROMHELLO_KEY && env.NEXT_PUBLIC_FROMHELLO_API_URL && (
          <Script
            src={`${env.NEXT_PUBLIC_FROMHELLO_API_URL.replace(/\/$/, "")}/api/t.js`}
            data-key={env.NEXT_PUBLIC_FROMHELLO_KEY}
            data-cookie-domain={env.NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN || undefined}
            strategy="afterInteractive"
          />
        )}

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
            <PostHogBootstrap />
            <InstanceProvider config={instanceConfig}>
              <NuqsAdapter>
                <EvlogProvider>
                  <ORPCProvider>
                    <ToastProvider position="top-center">
                      <AnchoredToastProvider>{children}</AnchoredToastProvider>
                    </ToastProvider>
                  </ORPCProvider>
                </EvlogProvider>
              </NuqsAdapter>
            </InstanceProvider>
          </PublicEnvProvider>
        </body>
      </html>
    </>
  );
}
