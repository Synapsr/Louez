"use client";

import { usePathname } from "next/navigation";

import { useStore } from "@/contexts/store-context";
import {
  getStorefrontChromeVariant,
  type StorefrontChromeVariant,
} from "@/lib/utils/util.storefront-chrome";

/** Chrome variant of the current route, host prefix and proxy slug removed. */
export const useChromeVariant = (): StorefrontChromeVariant => {
  const pathname = usePathname();
  const { basePath, storeSlug } = useStore();

  return getStorefrontChromeVariant(pathname, { basePath, storeSlug });
};
