"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowRight, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DeliverySettings } from "@louez/types";
import { Button, RadioGroup, RadioGroupItem, StepActions } from "@louez/ui";
import { cn } from "@louez/utils";

import { withForm } from "@/hooks/form/form";
import { useFormatMoney } from "@/hooks/use-format-money";
import { useMyLocation } from "@/hooks/use-my-location";
import { isFreeDelivery } from "@/lib/utils/geo";

import type { useCheckoutDelivery } from "../hooks/use-checkout-delivery";
import { buildLegMapView } from "../util.checkout-fulfillment-map";
import { buildCheckoutLocations, fromLocationKey } from "../util.checkout-locations";
import { STEP_ACTIONS_CLASS } from "../util.checkout-steps";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutFulfillmentLeg } from "./checkout-fulfillment-leg";
import { CheckoutFulfillmentMapPanel } from "./checkout-fulfillment-map-panel";

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
      <div className="flex flex-col gap-6">
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("returnTitle")}</h3>

            <RadioGroup
              name="fulfillment-return-scope"
              aria-label={t("returnTitle")}
              value={delivery.isReturnSameAsPickup ? "same" : "different"}
              onValueChange={(value) => {
                const isSame = value === "same";
                delivery.handleReturnSameAsPickupChange(isSame);
                setActiveLeg(isSame ? "outbound" : "return");
              }}
              className="flex-row gap-1.5"
            >
              {(
                [
                  ["same", t("returnSamePlace")],
                  ["different", t("returnSomewhereElse")],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none",
                    (value === "same") === delivery.isReturnSameAsPickup
                      ? "bg-foreground text-background"
                      : "bg-muted hover:bg-accent",
                  )}
                >
                  <span className="sr-only">
                    <RadioGroupItem value={value} />
                  </span>
                  {label}
                </label>
              ))}
            </RadioGroup>
          </div>

          {isSplit ? (
            <CheckoutFulfillmentLeg
              {...sharedLegProps}
              leg="return"
              method={delivery.returnMethod}
              onMethodChange={(method) => {
                delivery.handleReturnMethodChange(method);
                if (method === "address") onUseCustomerAddress("return");
              }}
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

        <StepActions className={STEP_ACTIONS_CLASS}>
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
        </StepActions>
      </div>
    );
  },
});
