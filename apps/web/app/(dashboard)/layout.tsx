import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { getCurrentStore } from "@/lib/store-context";

import { DashboardLayoutContent } from "./dashboard-layout-content";

export const generateMetadata = async (): Promise<Metadata> => {
  const store = await getCurrentStore();
  const iconUrl = store?.faviconUrl || store?.logoUrl;

  return {
    title: {
      default: "Dashboard",
      template: "%s | Dashboard",
    },
    ...(iconUrl && {
      icons: {
        icon: iconUrl,
        shortcut: iconUrl,
        apple: iconUrl,
      },
    }),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Dashboard",
      statusBarStyle: "default",
    },
  };
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Authentication and active-store selection are request-bound security gates.
export const instant = false;

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
};

export default DashboardLayout;
