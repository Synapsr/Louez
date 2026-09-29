"use client";
import type { FeatureDemoScene } from "@/lib/landing-demos/policy";
import {
  AnalyticsFleetScene,
  AnalyticsSalesScene,
  ApiKeyPermissionsScene,
  BookingConfirmationScene,
  CheckoutDeliveryScene,
  CheckoutPaymentScene,
  ContractContentScene,
  ContractDocumentScene,
  ContractTraceScene,
  CustomerDetailScene,
  CustomerRemindersScene,
  CustomersSearchScene,
  DeliveryCalendarScene,
  DeliverySettingsScene,
  DeliverySimulatorScene,
  InspectionCompareScene,
  InspectionItemsScene,
  InspectionSettingsScene,
  InspectionWizardScene,
  MultiStoreChartScene,
  MultiStoreScene,
  NotificationSettingsScene,
  PlanningScene,
  PortalAccessScene,
  PortalAccountScene,
  PortalLoginScene,
  PortalQuoteScene,
  PricingLadderScene,
  PricingSeasonsPromosScene,
  ProductAvailabilityScene,
  ProductsFilterScene,
  ProductsListScene,
  ReservationScene,
  StorefrontExtrasScene,
  StorefrontHomeScene,
  StorefrontPricingScene,
  StorefrontProductScene,
  StorefrontQuickAddScene,
  TeamInviteScene,
} from "./demo-scene-loaders";
import type { FeatureSceneProps } from "./feature-demo.types";

/** The product screen behind each marketing feature page slot. */
export const FeatureScene = ({
  scene,
  period,
  booking,
  onOpenReservation,
}: FeatureSceneProps & { scene: FeatureDemoScene }) => {
  switch (scene) {
    case "contract-trace":
      return (
        <ContractTraceScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "contract-content":
      return (
        <ContractContentScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "contract-document":
      return (
        <ContractDocumentScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "checkout-delivery":
      return (
        <CheckoutDeliveryScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "checkout-payment":
      return (
        <CheckoutPaymentScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "portal-account":
      return (
        <PortalAccountScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "portal-quote":
      return (
        <PortalQuoteScene period={period} booking={booking} onOpenReservation={onOpenReservation} />
      );
    case "portal-login":
      return (
        <PortalLoginScene period={period} booking={booking} onOpenReservation={onOpenReservation} />
      );
    case "portal-access":
      return (
        <PortalAccessScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "storefront-home":
      return (
        <StorefrontHomeScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "storefront-extras":
      return (
        <StorefrontExtrasScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "storefront-quick-add":
      return (
        <StorefrontQuickAddScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "storefront-pricing":
      return (
        <StorefrontPricingScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "storefront-product":
      return (
        <StorefrontProductScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "booking-confirmation":
      return (
        <BookingConfirmationScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "customer-reminders":
      return (
        <CustomerRemindersScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "notification-settings":
      return (
        <NotificationSettingsScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "customers-search":
      return (
        <CustomersSearchScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "customer-detail":
      return (
        <CustomerDetailScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "delivery-calendar":
      return (
        <DeliveryCalendarScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "delivery-simulator":
      return (
        <DeliverySimulatorScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "delivery-settings":
      return (
        <DeliverySettingsScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "team-invite":
      return (
        <TeamInviteScene period={period} booking={booking} onOpenReservation={onOpenReservation} />
      );
    case "multi-store-chart":
      return (
        <MultiStoreChartScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "multi-store":
      return (
        <MultiStoreScene period={period} booking={booking} onOpenReservation={onOpenReservation} />
      );
    case "inspection-settings":
      return (
        <InspectionSettingsScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "inspection-compare":
      return (
        <InspectionCompareScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "inspection-items":
      return (
        <InspectionItemsScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "inspection-wizard":
      return (
        <InspectionWizardScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "pricing-seasons-promos":
      return (
        <PricingSeasonsPromosScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "pricing-ladder":
      return (
        <PricingLadderScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "product-availability":
      return (
        <ProductAvailabilityScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "products-filter":
      return (
        <ProductsFilterScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "products-list":
      return (
        <ProductsListScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "analytics-fleet":
      return (
        <AnalyticsFleetScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "analytics-sales":
      return (
        <AnalyticsSalesScene
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "api-key-permissions":
      return <ApiKeyPermissionsScene />;
    case "reservations-paid":
      return (
        <PlanningScene
          initialView="list"
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
    case "reservation-deposit":
      return (
        <ReservationScene
          period={period}
          booking={booking}
          reservationIndex={0}
          onNavigate={() => undefined}
        />
      );
    case "planning-timeline":
      return (
        <PlanningScene
          initialView="planning"
          busy
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
        />
      );
  }
};
