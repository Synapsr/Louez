import { getTranslations } from "next-intl/server";

import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";
import { StoreMapPanel } from "@/components/storefront/home/store-map-panel";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import type { StoreContactChannels } from "@/lib/storefront/util.store-contact";

interface StoreLocationProps {
  name: string;
  address: string;
  /** Channels already resolved against the store's contact settings. */
  contact: Pick<StoreContactChannels, "phone" | "sms" | "whatsapp" | "email">;
  latitude: string | null;
  longitude: string | null;
}

/** Where to pick up: address and the offered contact channels as tappable rows, the map next to them. */
export const StoreLocation = async ({
  name,
  address,
  contact,
  latitude,
  longitude,
}: StoreLocationProps) => {
  const t = await getTranslations("storefront.home");
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
          />
        </div>

        <StoreMapPanel
          name={name}
          address={address}
          latitude={latitude}
          longitude={longitude}
          className="h-64 sm:h-80 lg:h-96"
        />
      </div>
    </StorefrontSection>
  );
};
