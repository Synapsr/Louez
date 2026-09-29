import { addDays, format, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Locale } from "@/i18n/config";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type {
  ProductPageBooking,
  ProductPageProduct,
  ProductPageStore,
} from "@/lib/storefront/product-page.loader";
import type { AccessoryLink, StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { summarizeCart, type CartItem } from "@/lib/utils/util.cart-lines";
import { toCartLineInput } from "@/lib/utils/util.cart-line-input";
import { IMG } from "@/scripts/seed/demo/catalog";
import { DEMO_RULES, getDemoCategories, getDemoProducts } from "./fixtures";
import { getDemoCart } from "./cart";
import { getDemoProductPageText } from "./text.product-page";

export const getDemoProductPage = (
  locale: Locale = "fr",
  productId = "demo-city-bike",
  withAccessories = false,
) => {
  const products = getDemoProducts(locale);
  const source = products.find((product) => product.id === productId) ?? products[0];
  if (!source) throw new Error("The demo catalog must contain a product");
  const text = getDemoProductPageText(locale);
  const category = getDemoCategories(locale).find((entry) => source.categoryIds.includes(entry.id));
  const helmet: AccessoryLink = {
    id: "demo-helmet",
    name: text.helmet,
    price: "3",
    deposit: "20",
    images: [IMG.helmet],
    quantity: 12,
    pricingKind: "duration",
    pricingMode: "day",
    basePeriodMinutes: 1440,
  };
  const accessories: AccessoryLink[] = withAccessories
    ? [
        helmet,
        ...products
          .filter((product) => ["demo-child-seat", "demo-panniers"].includes(product.id))
          .map((product) => ({
            ...product,
            deposit: product.deposit ?? "0",
            pricingMode: product.pricingMode ?? "day",
            pricingTiers: product.pricingTiers ?? [],
          })),
      ]
    : [];
  const product: ProductPageProduct = {
    id: source.id,
    name: source.name,
    slug: source.id,
    description: source.categoryIds.includes("accessories") ? null : `<p>${text.description}</p>`,
    images: source.id === "demo-city-bike" ? [IMG.city, IMG.cityAlt] : (source.images ?? []),
    videoUrl: null,
    price: source.price,
    deposit: source.deposit ?? "0",
    pricingKind: "duration",
    pricingMode: "day",
    basePeriodMinutes: source.id === "demo-city-bike" ? null : 1440,
    enforceStrictTiers: false,
    seasonalPricings: [],
    stockKind: "returnable",
    trackUnits: false,
    pricingTiers:
      source.id === "demo-city-bike"
        ? [
            {
              id: "demo-three-days",
              minDuration: 3,
              discountPercent: "15",
              period: null,
              price: null,
              displayOrder: 0,
            },
            {
              id: "demo-week",
              minDuration: 7,
              discountPercent: "25",
              period: null,
              price: null,
              displayOrder: 1,
            },
          ]
        : [],
    category: category ? { id: category.id, name: category.name, slug: category.id } : null,
  };
  const booking: ProductPageBooking = {
    isAvailable: true,
    unavailableReason: null,
    maxQuantity: source.quantity,
    attributeAxes: [],
    attributeValues: {},
    combinations: [],
    units: [],
    advanceNoticeMinutes: 0,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    businessHours: undefined,
    timezone: DEMO_RULES.timezone,
  };
  const store: ProductPageStore = {
    id: "demo-store",
    name: "Maison du Vélo",
    slug: "maison-du-velo",
    currency: "EUR",
    address: "12 rue des Cyclistes, 44000 Nantes",
    reservationMode: "payment",
    settings: {
      timezone: DEMO_RULES.timezone,
      reservationMode: "payment",
      advanceNoticeMinutes: 0,
    },
    theme: { mode: "light", primaryColor: "#10b981" },
  };
  const catalogProduct: StorefrontCatalogProduct = {
    ...product,
    quantity: source.quantity,
    accessories,
  };
  return {
    product,
    booking,
    store,
    accessories,
    catalogProduct,
    relatedProducts: products.filter((entry) => entry.id !== product.id).slice(0, 4),
  };
};

/** The catalog and detail advertise exactly the same rates after editing dates. */
export const getDemoProductCatalog = (locale: Locale = "fr", withAccessories = false) => {
  const { catalogProduct } = getDemoProductPage(locale, "demo-city-bike", withAccessories);
  return getDemoProducts(locale).map((product) =>
    product.id === catalogProduct.id ? { ...product, ...catalogProduct } : product,
  );
};

/** Same local cart model as the landing, preserving the richer product's real pricing inputs. */
export const getDemoProductCart = (
  quantities: Readonly<Record<string, number>>,
  period: RentalPeriodValue,
  locale: Locale = "fr",
) => {
  const base = getDemoCart(quantities, period, locale);
  const { catalogProduct, accessories } = getDemoProductPage(locale, "demo-city-bike", true);
  const products: StorefrontCatalogProduct[] = [catalogProduct, ...accessories];
  const items: CartItem[] = base.items.filter(
    (item) => !products.some((product) => product.id === item.productId),
  );
  for (const product of products) {
    const requested = quantities[product.id] ?? 0;
    if (!Number.isFinite(requested) || requested < 1) continue;
    const quantity = Math.min(Math.floor(requested), product.quantity ?? requested);
    items.push({
      ...toCartLineInput(product, {
        quantity,
        maxQuantity: product.quantity,
        requiredAccessories: [],
      }),
      lineId: product.id,
      selectionSignature: "__default",
      timezone: DEMO_RULES.timezone,
      ...base.period,
    });
  }
  return { items, period: base.period, summary: summarizeCart(items, base.period, null) };
};

/** Calendar dates are wall-clock days in the shop, independent of the viewer's timezone. */
export const getDemoProductCalendar = (period: RentalPeriodValue) => {
  const reference = startOfDay(toZonedTime(period.start, DEMO_RULES.timezone));
  const unavailableDates = [addDays(reference, 1), addDays(reference, 2)].map((day) =>
    format(day, "yyyy-MM-dd"),
  );
  const isDayUnavailable = (day: Date): boolean =>
    unavailableDates.includes(format(day, "yyyy-MM-dd"));
  const isPeriodAvailable = (selection: RentalPeriodValue): boolean => {
    const start = format(toZonedTime(selection.start, DEMO_RULES.timezone), "yyyy-MM-dd");
    const end = format(toZonedTime(selection.end, DEMO_RULES.timezone), "yyyy-MM-dd");
    return !unavailableDates.some((date) => date >= start && date <= end);
  };
  return { reference, unavailableDates, isDayUnavailable, isPeriodAvailable };
};
