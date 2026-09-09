"use client";

import { usePathname } from "next/navigation";

import { useStore } from "@/contexts/store-context";
import { getStorefrontStorePath } from "@/lib/utils/util.storefront-chrome";

/**
 * The current route as the store sees it (`/`, `/catalog`, `/checkout`),
 * with the host prefix and the proxy slug removed. Chrome that steps back
 * on one page in particular compares against this, never against the raw
 * pathname, which differs between the server and the browser.
 */
export const useStorePath = (): string => {
  const pathname = usePathname();
  const { basePath, storeSlug } = useStore();

  return getStorefrontStorePath(pathname, { basePath, storeSlug });
};
