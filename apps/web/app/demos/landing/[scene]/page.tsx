import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";

import { LandingDemo } from "@/components/landing-demos/landing-demo";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { isDemoScene } from "@/lib/landing-demos/policy";
import messages from "@/messages/fr.json";

export const metadata: Metadata = {
  title: "Démonstration Louez",
  robots: { index: false, follow: false },
};

const DemoContent = async ({
  params,
  searchParams,
}: {
  params: Promise<{ scene: string }>;
  searchParams: Promise<{ compact?: string }>;
}) => {
  await connection();
  const { scene } = await params;
  if (!isDemoScene(scene)) notFound();
  const { compact } = await searchParams;
  return (
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <LandingDemo scene={scene} compact={compact === "1"} initialPeriod={createDemoPeriod()} />
    </NextIntlClientProvider>
  );
};

const DemoPage = (props: Parameters<typeof DemoContent>[0]) => (
  <Suspense
    fallback={<p className="p-6 text-sm text-muted-foreground">Chargement de la démonstration…</p>}
  >
    <DemoContent {...props} />
  </Suspense>
);
export default DemoPage;
