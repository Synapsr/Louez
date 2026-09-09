"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import type { LegMethod } from "@louez/types";
import { RadioGroup } from "@louez/ui";

import type { MyLocation, MyLocationPermission } from "@/hooks/use-my-location";

import type { DeliveryAddress } from "../checkout.types";
import type { CheckoutLocation } from "../util.checkout-locations";
import { CheckoutDeliveryAddressField } from "./checkout-delivery-address-field";
import { CheckoutLocationList } from "./checkout-location-list";
import { CheckoutLocationSortPrompt } from "./checkout-location-sort-prompt";
import { CheckoutMethodOption } from "./checkout-method-option";

interface CheckoutFulfillmentLegProps {
  leg: "outbound" | "return";
  method: LegMethod;
  onMethodChange: (method: LegMethod) => void;
  isAddressDeliveryEnabled: boolean;
  isAddressDeliveryAvailable: boolean;
  /** Price shown on the address option, e.g. a per-km rate or "Free". */
  deliveryPrice: string;
  isDeliveryFree: boolean;
  locations: CheckoutLocation[];
  selectedLocationId: string | null;
  onLocationChange: (locationId: string | null) => void;
  address: DeliveryAddress;
  onAddressChange: (address: string, latitude: number | null, longitude: number | null) => void;
  error: string | null;
  permission: MyLocationPermission;
  isLocating: boolean;
  isLocated: boolean;
  onLocate: (onResolved?: (found: MyLocation) => void) => void;
  maximumDistance: number | null;
  pricePerKm: string;
  /** The map for this leg, rendered under its choices. */
  children?: ReactNode;
}

const isLegMethod = (value: unknown): value is LegMethod =>
  value === "store" || value === "address";

/** One half of the journey: how the equipment gets out, or comes back. */
export const CheckoutFulfillmentLeg = ({
  leg,
  method,
  onMethodChange,
  isAddressDeliveryEnabled,
  isAddressDeliveryAvailable,
  deliveryPrice,
  isDeliveryFree,
  locations,
  selectedLocationId,
  onLocationChange,
  address,
  onAddressChange,
  error,
  permission,
  isLocating,
  isLocated,
  onLocate,
  maximumDistance,
  pricePerKm,
  children,
}: CheckoutFulfillmentLegProps) => {
  const t = useTranslations("storefront.checkout");
  const isOutbound = leg === "outbound";

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        name={`fulfillment-${leg}-method`}
        aria-label={isOutbound ? t("outboundTitle") : t("returnTitle")}
        value={method}
        onValueChange={(value) => {
          if (isLegMethod(value)) onMethodChange(value);
        }}
        className="flex-row flex-wrap gap-1.5"
      >
        <CheckoutMethodOption
          value="store"
          label={isOutbound ? t("pickupAtLocation") : t("returnAtLocation")}
          price={t("free")}
          isFree
          isSelected={method === "store"}
        />
        {isAddressDeliveryEnabled ? (
          <CheckoutMethodOption
            value="address"
            label={isOutbound ? t("deliverToAddress") : t("collectFromAddress")}
            price={deliveryPrice}
            isFree={isDeliveryFree}
            isSelected={method === "address"}
            isDisabled={!isAddressDeliveryAvailable}
          />
        ) : null}
      </RadioGroup>

      {method === "store" ? (
        <>
          <CheckoutLocationSortPrompt
            permission={permission}
            isLocating={isLocating}
            isLocated={isLocated}
            onLocate={onLocate}
          />
          <CheckoutLocationList
            leg={leg}
            locations={locations}
            selectedLocationId={selectedLocationId}
            onLocationChange={onLocationChange}
          />
        </>
      ) : (
        <CheckoutDeliveryAddressField
          leg={leg}
          address={address}
          onAddressChange={onAddressChange}
          error={error}
          isLocating={isLocating}
          onLocate={onLocate}
          maximumDistance={maximumDistance}
          pricePerKm={pricePerKm}
        />
      )}

      {children}
    </div>
  );
};
