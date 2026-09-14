"use client";

import { useOnlineStoreEditor } from "../online-store-editor-context";
import type { OnlineStoreSection } from "../online-store.constants";
import { ContactSection } from "../sections/contact-section";
import { HomeSection } from "../sections/home-section";
import { IdentitySection } from "../sections/identity-section";
import { LegalSection } from "../sections/legal-section";
import { SeoSection } from "../sections/seo-section";

interface OnlineStoreSectionPanelProps {
  section: OnlineStoreSection;
}

/**
 * The routed side of the editor: the section's groups of fields, fed from
 * the one editor form, with a rule between two groups. The top bar and the
 * rail already name the section, so the panel starts with its first group.
 * Each route page renders this with its section.
 */
export const OnlineStoreSectionPanel = ({ section }: OnlineStoreSectionPanelProps) => {
  const { form, uploads, savedValues, store } = useOnlineStoreEditor();
  const sectionProps = { form, uploads, savedValues, store };

  return (
    <div className="flex flex-col divide-y" data-slot="online-store-section-panel">
      {section === "identity" ? <IdentitySection {...sectionProps} /> : null}
      {section === "home" ? <HomeSection {...sectionProps} /> : null}
      {section === "contact" ? <ContactSection {...sectionProps} /> : null}
      {section === "legal" ? <LegalSection {...sectionProps} /> : null}
      {section === "seo" ? <SeoSection {...sectionProps} /> : null}
    </div>
  );
};
