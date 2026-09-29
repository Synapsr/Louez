import type { BusinessHours } from "@louez/types";

import type { Locale } from "@/i18n/config";
import { getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getStorefrontHomeDemoText } from "@/lib/landing-demos/text.storefront-home";
import type { StoreThemeInput } from "@/lib/theme/util.store-theme";
import type { StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";
import { IMG } from "@/scripts/seed/demo/catalog";

const openDay = { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "18:00" }] };

export const STOREFRONT_HOME_HOURS: BusinessHours = {
  enabled: true,
  schedule: {
    0: openDay,
    1: openDay,
    2: openDay,
    3: openDay,
    4: openDay,
    5: openDay,
    6: openDay,
  },
  closurePeriods: [],
};

export const STOREFRONT_HOME_THEME: StoreThemeInput = {
  mode: "light",
  primaryColor: "#176B46",
};

export const getStorefrontHomeDemo = (locale: Locale) => {
  const text = getStorefrontHomeDemoText(locale);

  return {
    name: "Maison du Vélo",
    address: "12 rue des Cyclistes\n44000 Nantes",
    phone: "02 40 00 00 00",
    email: "bonjour@maisonduvelo.example",
    tagline: text.tagline,
    announcement: { text: text.announcement, href: null, external: false },
    // Keep the real StoreLogo text fallback instead of borrowing another shop's identity.
    logoUrl: null,
    heroImages: [IMG.city, IMG.cargoE],
    rating: 4.9,
    reviewCount: 128,
    reassurance: [
      "instantConfirmation",
      "securePayment",
      "localPickup",
    ] satisfies StoreReassuranceKey[],
    products: getDemoProducts(locale).slice(0, 8),
  };
};
