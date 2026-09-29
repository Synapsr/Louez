import { lazy } from "react";

export const loadStorefront = () =>
  import("./storefront-scene").then((module) => ({ default: module.StorefrontScene }));
export const loadPlanning = () =>
  import("./planning-scene").then((module) => ({ default: module.PlanningScene }));
export const loadReservation = () =>
  import("./reservation-scene").then((module) => ({ default: module.ReservationScene }));
const loadAdvisor = () =>
  import("./advisor-scene").then((module) => ({ default: module.AdvisorScene }));

// Feature page scenes, one chunk each.
export const ApiKeyPermissionsScene = lazy(() =>
  import("./features/api-key-permissions").then((module) => ({
    default: module.ApiKeyPermissionsScene,
  })),
);

export const AnalyticsSalesScene = lazy(() =>
  import("./features/analytics-sales").then((module) => ({ default: module.AnalyticsSalesScene })),
);

export const AnalyticsFleetScene = lazy(() =>
  import("./features/analytics-fleet").then((module) => ({ default: module.AnalyticsFleetScene })),
);

export const ProductsListScene = lazy(() =>
  import("./features/products-list").then((module) => ({ default: module.ProductsListScene })),
);

export const ProductsFilterScene = lazy(() =>
  import("./features/products-filter").then((module) => ({ default: module.ProductsFilterScene })),
);

export const ProductAvailabilityScene = lazy(() =>
  import("./features/product-availability").then((module) => ({
    default: module.ProductAvailabilityScene,
  })),
);

export const PricingLadderScene = lazy(() =>
  import("./features/pricing-ladder").then((module) => ({ default: module.PricingLadderScene })),
);

export const PricingSeasonsPromosScene = lazy(() =>
  import("./features/pricing-seasons-promos").then((module) => ({
    default: module.PricingSeasonsPromosScene,
  })),
);

export const InspectionWizardScene = lazy(() =>
  import("./features/inspection-wizard").then((module) => ({
    default: module.InspectionWizardScene,
  })),
);

export const InspectionItemsScene = lazy(() =>
  import("./features/inspection-items").then((module) => ({
    default: module.InspectionItemsScene,
  })),
);

export const InspectionCompareScene = lazy(() =>
  import("./features/inspection-compare").then((module) => ({
    default: module.InspectionCompareScene,
  })),
);

export const InspectionSettingsScene = lazy(() =>
  import("./features/inspection-settings").then((module) => ({
    default: module.InspectionSettingsScene,
  })),
);

export const MultiStoreScene = lazy(() =>
  import("./features/multi-store").then((module) => ({ default: module.MultiStoreScene })),
);

export const MultiStoreChartScene = lazy(() =>
  import("./features/multi-store-chart").then((module) => ({
    default: module.MultiStoreChartScene,
  })),
);

export const TeamInviteScene = lazy(() =>
  import("./features/team-invite").then((module) => ({ default: module.TeamInviteScene })),
);

export const DeliverySettingsScene = lazy(() =>
  import("./features/delivery-settings").then((module) => ({
    default: module.DeliverySettingsScene,
  })),
);

export const DeliverySimulatorScene = lazy(() =>
  import("./features/delivery-simulator").then((module) => ({
    default: module.DeliverySimulatorScene,
  })),
);

export const DeliveryCalendarScene = lazy(() =>
  import("./features/delivery-calendar").then((module) => ({
    default: module.DeliveryCalendarScene,
  })),
);

export const CustomerDetailScene = lazy(() =>
  import("./features/customer-detail").then((module) => ({ default: module.CustomerDetailScene })),
);

export const CustomersSearchScene = lazy(() =>
  import("./features/customers-search").then((module) => ({
    default: module.CustomersSearchScene,
  })),
);

export const NotificationSettingsScene = lazy(() =>
  import("./features/notification-settings").then((module) => ({
    default: module.NotificationSettingsScene,
  })),
);

export const CustomerRemindersScene = lazy(() =>
  import("./features/customer-reminders").then((module) => ({
    default: module.CustomerRemindersScene,
  })),
);

export const BookingConfirmationScene = lazy(() =>
  import("./features/booking-confirmation").then((module) => ({
    default: module.BookingConfirmationScene,
  })),
);

export const StorefrontProductScene = lazy(() =>
  import("./features/storefront-product").then((module) => ({
    default: module.StorefrontProductScene,
  })),
);

export const StorefrontPricingScene = lazy(() =>
  import("./features/storefront-pricing").then((module) => ({
    default: module.StorefrontPricingScene,
  })),
);

export const StorefrontQuickAddScene = lazy(() =>
  import("./features/storefront-quick-add").then((module) => ({
    default: module.StorefrontQuickAddScene,
  })),
);

export const StorefrontExtrasScene = lazy(() =>
  import("./features/storefront-extras").then((module) => ({
    default: module.StorefrontExtrasScene,
  })),
);

export const StorefrontHomeScene = lazy(() =>
  import("./features/storefront-home").then((module) => ({ default: module.StorefrontHomeScene })),
);

export const PortalAccessScene = lazy(() =>
  import("./features/portal-access").then((module) => ({ default: module.PortalAccessScene })),
);

export const PortalLoginScene = lazy(() =>
  import("./features/portal-login").then((module) => ({ default: module.PortalLoginScene })),
);

export const PortalQuoteScene = lazy(() =>
  import("./features/portal-quote").then((module) => ({ default: module.PortalQuoteScene })),
);

export const PortalAccountScene = lazy(() =>
  import("./features/portal-account").then((module) => ({ default: module.PortalAccountScene })),
);

export const CheckoutPaymentScene = lazy(() =>
  import("./features/checkout-payment").then((module) => ({
    default: module.CheckoutPaymentScene,
  })),
);

export const CheckoutDeliveryScene = lazy(() =>
  import("./features/checkout-delivery").then((module) => ({
    default: module.CheckoutDeliveryScene,
  })),
);

export const ContractDocumentScene = lazy(() =>
  import("./features/contract-document").then((module) => ({
    default: module.ContractDocumentScene,
  })),
);

export const ContractContentScene = lazy(() =>
  import("./features/contract-content").then((module) => ({
    default: module.ContractContentScene,
  })),
);

export const ContractTraceScene = lazy(() =>
  import("./features/contract-trace").then((module) => ({ default: module.ContractTraceScene })),
);

export const StorefrontScene = lazy(loadStorefront);
export const PlanningScene = lazy(loadPlanning);
export const ReservationScene = lazy(loadReservation);
export const AdvisorScene = lazy(loadAdvisor);
