import { StoreLocationView } from "@/components/storefront/home/store-location-view";
import { StoreMapPanel } from "@/components/storefront/home/store-map-panel";
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
  return (
    <StoreLocationView
      address={address}
      contact={contact}
      map={
        <StoreMapPanel
          name={name}
          address={address}
          latitude={latitude}
          longitude={longitude}
          className="h-64 sm:h-80 lg:h-96"
        />
      }
    />
  );
};
