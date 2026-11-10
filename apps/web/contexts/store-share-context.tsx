"use client";

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { ShareModal } from "@/components/dashboard/home/share-modal";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";

interface StoreShareContextValue {
  /** The public address to share; null when there is none yet. */
  url: string | null;
  /** Opens the share sheet: link, WhatsApp, e-mail, SMS and QR code. */
  open: () => void;
}

const StoreShareContext = createContext<StoreShareContextValue | null>(null);

interface StoreShareProviderProps {
  storeSlug: string;
  storeName: string;
  /** A store that came from reeent has no Louez storefront to promote. */
  isFromReeent: boolean;
  /** Its reeent listing, while it is published there. */
  listingUrl: string | null;
  children: ReactNode;
}

/**
 * One share sheet for the whole back office: the sidebar's store card, the
 * "Nouvelle réservation" menu and the home all open this one. The address is
 * the store's public page — its Louez storefront, or for a store from reeent
 * its listing there, and nothing to share until that listing is live.
 */
export const StoreShareProvider = ({
  storeSlug,
  storeName,
  isFromReeent,
  listingUrl,
  children,
}: StoreShareProviderProps) => {
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const [isOpen, setIsOpen] = useState(false);
  const url = isFromReeent ? listingUrl : getAbsoluteUrl();
  const value = useMemo(() => ({ url, open: () => setIsOpen(true) }), [url]);

  return (
    <StoreShareContext.Provider value={value}>
      {children}
      {url && (
        <ShareModal open={isOpen} onOpenChange={setIsOpen} storeUrl={url} storeName={storeName} />
      )}
    </StoreShareContext.Provider>
  );
};

/** Outside the provider (demos, isolated stories) there is nothing to share. */
export const useStoreShare = (): StoreShareContextValue =>
  useContext(StoreShareContext) ?? { url: null, open: () => undefined };
