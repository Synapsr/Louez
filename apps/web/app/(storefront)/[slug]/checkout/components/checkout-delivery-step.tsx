"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowRight, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DeliverySettings } from "@louez/types";
import { Button, StepContent } from "@louez/ui";

import { withForm } from "@/hooks/form/form";
import { useFormatMoney } from "@/hooks/use-format-money";
import { useMyLocation } from "@/hooks/use-my-location";
import { isFreeDelivery } from "@/lib/utils/geo";

import type { useCheckoutDelivery } from "../hooks/use-checkout-delivery";
import { buildLegMapView } from "../util.checkout-fulfillment-map";
import { buildCheckoutLocations, fromLocationKey, toLocationKey } from "../util.checkout-locations";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutFulfillmentLeg } from "./checkout-fulfillment-leg";
import { CheckoutFulfillmentMapPanel } from "./checkout-fulfillment-map-panel";
import { CheckoutReturnScope, type ReturnScope } from "./checkout-return-scope";
import { CheckoutStepActions } from "./checkout-step-actions";

type CheckoutDeliveryState = ReturnType<typeof useCheckoutDelivery>;
type Leg = "outbound" | "return";

interface CheckoutDeliveryStepProps {
  deliverySettings: DeliverySettings;
  delivery: CheckoutDeliveryState;
  subtotal: number;
  storeAddress?: string | null;
  storeName?: string;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  /** Called when a leg switches to an address so it can start from the customer's. */
  onUseCustomerAddress: (leg: Leg) => void;
  onBack: () => void;
  onContinue: () => void;
  /** Direction the step flow moved in, for the entrance animation. */
  stepDirection: "forward" | "backward";
}

export const CheckoutDeliveryStep = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutDeliveryStepProps>(),
  render: ({
    deliverySettings,
    delivery,
    subtotal,
    storeAddress,
    storeName,
    storeLatitude,
    storeLongitude,
    onUseCustomerAddress,
    onBack,
    onContinue,
    stepDirection,
  }) => {
    const t = useTranslations("storefront.checkout");
    const formatMoney = useFormatMoney();
    const { position, isLocating, permission, locate } = useMyLocation();

    // The map belongs to whichever leg is being edited. Both panels stay
    // mounted, so moving between legs hides one and reveals the other rather
    // than tearing the map down and rebuilding it.
    const [activeLeg, setActiveLeg] = useState<Leg>("outbound");
    const [isMapExpanded, setIsMapExpanded] = useState(false);

    // Asking on arrival costs one tap and lets the list open nearest-first.
    const hasAskedForLocationRef = useRef(false);
    useEffect(() => {
      if (hasAskedForLocationRef.current) return;
      hasAskedForLocationRef.current = true;
      locate();
    }, [locate]);

    const storeLabel = storeName ?? t("storeLocationFallback");

    const locations = useMemo(
      () =>
        buildCheckoutLocations(
          delivery.locations.length > 0
            ? delivery.locations
            : [
                {
                  id: null,
                  name: storeLabel,
                  address: storeAddress ?? null,
                  city: null,
                  postalCode: null,
                  country: null,
                  latitude: storeLatitude ?? null,
                  longitude: storeLongitude ?? null,
                },
              ],
          position,
        ),
      [delivery.locations, position, storeAddress, storeLabel, storeLatitude, storeLongitude],
    );

    const origin =
      storeLatitude != null && storeLongitude != null
        ? { latitude: storeLatitude, longitude: storeLongitude }
        : null;

    const isSplit = !delivery.isReturnSameAsPickup;
    const hasAnyDelivery =
      delivery.outboundMethod === "address" || delivery.returnMethod === "address";
    const isDeliveryFree =
      delivery.isDeliveryIncluded || isFreeDelivery(subtotal, deliverySettings);
    const pricePerKm = formatMoney(deliverySettings.pricePerKm);
    const deliveryPrice = delivery.isDeliveryIncluded
      ? t("included")
      : !delivery.isDeliveryAmountEligible && deliverySettings.minimumOrderAmountForDelivery != null
        ? t("deliveryAvailableFrom", {
            amount: formatMoney(deliverySettings.minimumOrderAmountForDelivery),
          })
        : isDeliveryFree
          ? t("free")
          : t("pricePerKm", { price: pricePerKm });

    const returnScope: ReturnScope = delivery.isReturnSameAsPickup
      ? "same"
      : delivery.returnMethod === "address"
        ? "address"
        : "location";

    const handleReturnScopeChange = (scope: ReturnScope) => {
      if (scope === "same") {
        delivery.handleReturnSameAsPickupChange(true);
        setActiveLeg("outbound");
        return;
      }

      delivery.handleReturnSameAsPickupChange(false);
      delivery.handleReturnMethodChange(scope === "address" ? "address" : "store");
      if (scope === "address") onUseCustomerAddress("return");
      setActiveLeg("return");
    };

    /** Spells out where "same place" actually sends the equipment back to. */
    const pickupLocationName = locations.find(
      (location) => location.key === toLocationKey(delivery.pickupLocationId),
    )?.name;
    const sameAsPickupSummary =
      delivery.outboundMethod === "address"
        ? delivery.outboundAddress.address
          ? t("returnSameAddressSummary", { address: delivery.outboundAddress.address })
          : null
        : pickupLocationName
          ? t("returnSameLocationSummary", { place: pickupLocationName })
          : null;

    /** Distance and price for a delivery leg, once both are known. */
    const legSummary = (leg: Leg) => {
      const isOutbound = leg === "outbound";
      const method = isOutbound ? delivery.outboundMethod : delivery.returnMethod;
      const distance = isOutbound ? delivery.outboundDistance : delivery.returnDistance;
      const fee = isOutbound ? delivery.outboundFee : delivery.returnFee;
      const error = isOutbound ? delivery.outboundError : delivery.returnError;

      if (method !== "address" || distance === null || error) return null;

      const price = delivery.isDeliveryIncluded
        ? t("included")
        : fee === 0
          ? t("free")
          : formatMoney(fee);

      return `${t("distanceKm", { distance: distance.toFixed(1) })} · ${price}`;
    };

    const renderMapPanel = (leg: Leg) => {
      const isOutbound = leg === "outbound";
      const onLocationChange = isOutbound
        ? delivery.handlePickupLocationChange
        : delivery.handleReturnLocationChange;

      const view = buildLegMapView({
        method: isOutbound ? delivery.outboundMethod : delivery.returnMethod,
        locations,
        selectedLocationId: isOutbound ? delivery.pickupLocationId : delivery.returnLocationId,
        address: isOutbound ? delivery.outboundAddress : delivery.returnAddress,
        origin,
        originLabel: storeLabel,
        customerPosition: position,
        customerLabel: t("yourPosition"),
        maximumDistance: deliverySettings.maximumDistance,
      });

      return (
        <CheckoutFulfillmentMapPanel
          pins={view.pins}
          selectedId={view.selectedId}
          onSelect={(id) => onLocationChange(fromLocationKey(id))}
          radius={view.radius}
          link={view.link}
          directionsHref={view.directionsHref}
          summary={legSummary(leg)}
          isExpanded={isMapExpanded}
          onExpandedChange={setIsMapExpanded}
          isHidden={isSplit ? activeLeg !== leg : leg !== "outbound"}
        />
      );
    };

    const sharedLegProps = {
      locations,
      permission,
      isLocating,
      isLocated: position !== null,
      onLocate: locate,
      isAddressDeliveryEnabled: delivery.isAddressDeliveryEnabled,
      isAddressDeliveryAvailable: delivery.isDeliveryAmountEligible,
      deliveryPrice,
      isDeliveryFree,
      maximumDistance: deliverySettings.maximumDistance,
      pricePerKm,
    };

    return (
      <>
        <StepContent className="flex flex-col gap-6" direction={stepDirection}>
          <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
            {t("fulfillmentTitle")}
          </h2>

          <section
            className="flex flex-col gap-3"
            onFocusCapture={() => setActiveLeg("outbound")}
            onPointerDownCapture={() => setActiveLeg("outbound")}
          >
            <h3 className="text-sm font-semibold">{t("outboundTitle")}</h3>

            <CheckoutFulfillmentLeg
              {...sharedLegProps}
              leg="outbound"
              method={delivery.outboundMethod}
              onMethodChange={(method) => {
                delivery.handleOutboundMethodChange(method);
                if (method === "address") onUseCustomerAddress("outbound");
              }}
              selectedLocationId={delivery.pickupLocationId}
              onLocationChange={delivery.handlePickupLocationChange}
              address={delivery.outboundAddress}
              onAddressChange={delivery.handleOutboundAddressChange}
              error={delivery.outboundError}
            >
              {renderMapPanel("outbound")}
            </CheckoutFulfillmentLeg>
          </section>

          <section
            className="flex flex-col gap-3 border-t pt-4"
            onFocusCapture={() => setActiveLeg("return")}
            onPointerDownCapture={() => setActiveLeg("return")}
          >
            <h3 className="text-sm font-semibold">{t("returnTitle")}</h3>

            <CheckoutReturnScope
              scope={returnScope}
              onScopeChange={handleReturnScopeChange}
              isAddressDeliveryEnabled={delivery.isAddressDeliveryEnabled}
              isAddressDeliveryAvailable={delivery.isDeliveryAmountEligible}
              deliveryPrice={deliveryPrice}
              isDeliveryFree={isDeliveryFree}
              isPickupAtAddress={delivery.outboundMethod === "address"}
              sameAsPickupSummary={sameAsPickupSummary}
            />

            {isSplit ? (
              <CheckoutFulfillmentLeg
                {...sharedLegProps}
                leg="return"
                showMethodChoice={false}
                method={delivery.returnMethod}
                onMethodChange={delivery.handleReturnMethodChange}
                selectedLocationId={delivery.returnLocationId}
                onLocationChange={delivery.handleReturnLocationChange}
                address={delivery.returnAddress}
                onAddressChange={delivery.handleReturnAddressChange}
                error={delivery.returnError}
              >
                {renderMapPanel("return")}
              </CheckoutFulfillmentLeg>
            ) : null}
          </section>

          {hasAnyDelivery && !delivery.isDeliveryIncluded && (
            <div className="flex items-center justify-between border-t pt-4 text-base font-medium">
              <span>{t("totalDeliveryFee")}</span>
              <span
                className={
                  delivery.canContinue && delivery.totalFee === 0 ? "text-success" : "tabular-nums"
                }
              >
                {!delivery.canContinue
                  ? "—"
                  : delivery.totalFee === 0
                    ? t("free")
                    : formatMoney(delivery.totalFee)}
              </span>
            </div>
          )}
        </StepContent>

        <CheckoutStepActions>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onBack}
            className="h-12 lg:h-10"
          >
            <ChevronLeft data-slot="icon" />
            {t("back")}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={onContinue}
            disabled={!delivery.canContinue}
            className="h-12 flex-1 lg:h-10 lg:flex-none"
          >
            {t("continue")}
            <ArrowRight data-slot="icon" />
          </Button>
        </CheckoutStepActions>
      </>
    );
  },
});
