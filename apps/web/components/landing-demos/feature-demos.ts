import type { FeatureDemoScene } from "@/lib/landing-demos/policy";
import type { FeatureDemoConfig } from "./feature-demo.types";
import { demo as contractTrace } from "./features/contract-trace.demo";
import { demo as contractContent } from "./features/contract-content.demo";
import { demo as contractDocument } from "./features/contract-document.demo";
import { demo as checkoutDelivery } from "./features/checkout-delivery.demo";
import { demo as checkoutPayment } from "./features/checkout-payment.demo";
import { demo as portalAccount } from "./features/portal-account.demo";
import { demo as portalQuote } from "./features/portal-quote.demo";
import { demo as portalLogin } from "./features/portal-login.demo";
import { demo as portalAccess } from "./features/portal-access.demo";
import { demo as storefrontHome } from "./features/storefront-home.demo";
import { demo as storefrontExtras } from "./features/storefront-extras.demo";
import { demo as storefrontQuickAdd } from "./features/storefront-quick-add.demo";
import { demo as storefrontPricing } from "./features/storefront-pricing.demo";
import { demo as storefrontProduct } from "./features/storefront-product.demo";
import { demo as bookingConfirmation } from "./features/booking-confirmation.demo";
import { demo as customerReminders } from "./features/customer-reminders.demo";
import { demo as notificationSettings } from "./features/notification-settings.demo";
import { demo as customersSearch } from "./features/customers-search.demo";
import { demo as customerDetail } from "./features/customer-detail.demo";
import { demo as deliveryCalendar } from "./features/delivery-calendar.demo";
import { demo as deliverySimulator } from "./features/delivery-simulator.demo";
import { demo as deliverySettings } from "./features/delivery-settings.demo";
import { demo as teamInvite } from "./features/team-invite.demo";
import { demo as multiStoreChart } from "./features/multi-store-chart.demo";
import { demo as multiStore } from "./features/multi-store.demo";
import { demo as inspectionSettings } from "./features/inspection-settings.demo";
import { demo as inspectionCompare } from "./features/inspection-compare.demo";
import { demo as inspectionItems } from "./features/inspection-items.demo";
import { demo as inspectionWizard } from "./features/inspection-wizard.demo";
import { demo as pricingSeasonsPromos } from "./features/pricing-seasons-promos.demo";
import { demo as pricingLadder } from "./features/pricing-ladder.demo";
import { demo as productAvailability } from "./features/product-availability.demo";
import { demo as productsFilter } from "./features/products-filter.demo";
import { demo as productsList } from "./features/products-list.demo";
import { demo as analyticsFleet } from "./features/analytics-fleet.demo";
import { demo as analyticsSales } from "./features/analytics-sales.demo";
import { demo as apiKeyPermissions } from "./features/api-key-permissions.demo";

// A scene of its own keeps its script next to it, in `features/<scene>.demo.ts`.
export const FEATURE_DEMOS: Record<FeatureDemoScene, FeatureDemoConfig> = {
  "contract-trace": contractTrace,
  "contract-content": contractContent,
  "contract-document": contractDocument,
  "checkout-delivery": checkoutDelivery,
  "checkout-payment": checkoutPayment,
  "portal-account": portalAccount,
  "portal-quote": portalQuote,
  "portal-login": portalLogin,
  "portal-access": portalAccess,
  "storefront-home": storefrontHome,
  "storefront-extras": storefrontExtras,
  "storefront-quick-add": storefrontQuickAdd,
  "storefront-pricing": storefrontPricing,
  "storefront-product": storefrontProduct,
  "booking-confirmation": bookingConfirmation,
  "customer-reminders": customerReminders,
  "notification-settings": notificationSettings,
  "customers-search": customersSearch,
  "customer-detail": customerDetail,
  "delivery-calendar": deliveryCalendar,
  "delivery-simulator": deliverySimulator,
  "delivery-settings": deliverySettings,
  "team-invite": teamInvite,
  "multi-store-chart": multiStoreChart,
  "multi-store": multiStore,
  "inspection-settings": inspectionSettings,
  "inspection-compare": inspectionCompare,
  "inspection-items": inspectionItems,
  "inspection-wizard": inspectionWizard,
  "pricing-seasons-promos": pricingSeasonsPromos,
  "pricing-ladder": pricingLadder,
  "product-availability": productAvailability,
  "products-filter": productsFilter,
  "products-list": productsList,
  "analytics-fleet": analyticsFleet,
  "analytics-sales": analyticsSales,
  "api-key-permissions": apiKeyPermissions,
  // The list with its « paid » badges; opening a row hands over to the reservation scene.
  "reservations-paid": {
    actor: "owner",
    duration: 4200,
    cues: [
      { at: 900, selector: '[data-demo-scene="planning"] tbody tr:first-child' },
      { at: 2600, selector: '[data-demo-scene="planning"] tbody tr:first-child a' },
      { at: 3400, selector: '[data-demo-scene="planning"] tbody tr:first-child a', click: true },
    ],
  },
  "reservation-deposit": {
    actor: "owner",
    duration: 7000,
    cues: [
      { at: 700, selector: "[data-reservation-deposit]" },
      { at: 3400, selector: "[data-reservation-history] button" },
      { at: 4300, selector: "[data-reservation-history] button", click: true },
    ],
  },
  "planning-timeline": {
    actor: "owner",
    duration: 7600,
    cues: [
      { at: 600, selector: "[data-reservations-planning-scroll]" },
      {
        at: 1200,
        selector: "[data-reservations-planning-scroll]",
        scroll: { x: 380, y: 0, duration: 1300 },
      },
      { at: 3000, selector: '[data-timeline-nav="next"]' },
      { at: 3800, selector: '[data-timeline-nav="next"]', click: true },
      { at: 5000, selector: "[data-reservations-planning-scroll] button[aria-expanded]" },
      {
        at: 5800,
        selector: "[data-reservations-planning-scroll] button[aria-expanded]",
        click: true,
      },
    ],
  },
};
