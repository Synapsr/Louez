import type { ReactNode } from "react";

import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { BackLink } from "@/components/storefront/ui/back-link";

interface LegalPageShellProps {
  title: string;
  children: ReactNode;
}

/** Narrow reading column shared by the legal notice and the terms. */
export const LegalPageShell = ({ title, children }: LegalPageShellProps) => (
  <StorefrontSection width="narrow">
    <BackLink href="/" />
    <SectionHeader level="h1" title={title} className="mt-2" />
    <div className="flex flex-col gap-6 sm:gap-8">{children}</div>
  </StorefrontSection>
);
