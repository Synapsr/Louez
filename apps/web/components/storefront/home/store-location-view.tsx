import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import type { StoreContactChannels } from "@/lib/storefront/util.store-contact";

interface StoreLocationViewProps {
  address: string;
  contact: Pick<StoreContactChannels, "phone" | "sms" | "whatsapp" | "email">;
  map?: ReactNode;
  autoFocus?: boolean;
}

/** The real address/contact section; the server supplies the map separately. */
export const StoreLocationView = ({
  address,
  contact,
  map,
  autoFocus = true,
}: StoreLocationViewProps) => {
  const t = useTranslations("storefront.home");

  return (
    <StorefrontSection id="contact" aria-labelledby="store-location-title">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div>
          <SectionHeader id="store-location-title" title={t("findUs")} />
          <StoreContactDetails
            address={address}
            phone={contact.phone}
            sms={contact.sms}
            whatsapp={contact.whatsapp}
            email={contact.email}
            autoFocus={autoFocus}
          />
        </div>
        {map}
      </div>
    </StorefrontSection>
  );
};
