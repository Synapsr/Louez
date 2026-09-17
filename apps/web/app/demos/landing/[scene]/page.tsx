import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";

import { LandingDemo } from "@/components/landing-demos/landing-demo";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { isDemoScene } from "@/lib/landing-demos/policy";
import { type DemoMessages, getDemoMessages } from "@/lib/landing-demos/messages";
import { getDemoLocale } from "@/lib/landing-demos/text";

type DemoSearchParams = { compact?: string; poster?: string; locale?: string | string[] };
type DemoPageProps = {
  params: Promise<{ scene: string }>;
  searchParams: Promise<DemoSearchParams>;
};

// The title never shows: the landing names each iframe itself. It stays language-neutral
// because reading `searchParams` here, outside <Suspense>, would block the route.
export const metadata: Metadata = {
  title: "Louez",
  robots: { index: false, follow: false },
};

const DemoContent = async ({ params, searchParams }: DemoPageProps) => {
  await connection();
  const { scene } = await params;
  if (!isDemoScene(scene)) notFound();
  const { compact, poster, locale: requested } = await searchParams;
  // The landing embeds the demo in the visitor's language; the app's cookie and
  // Accept-Language do not apply inside the iframe.
  const locale = getDemoLocale(requested);
  const messages = (await import(`@/messages/${locale}.json`)).default as DemoMessages;
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Europe/Paris"
      messages={getDemoMessages(scene, messages)}
    >
      <LandingDemo
        scene={scene}
        compact={compact === "1"}
        poster={poster === "1"}
        initialPeriod={createDemoPeriod()}
      />
    </NextIntlClientProvider>
  );
};

const DemoPage = (props: DemoPageProps) => (
  <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
    <DemoContent {...props} />
  </Suspense>
);
export default DemoPage;
