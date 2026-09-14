"use client";

import { Crosshair, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { AddressInput } from "@/components/ui/address-input";
import type { MyLocation } from "@/hooks/use-my-location";

import type { DeliveryAddress } from "../checkout.types";

interface CheckoutDeliveryAddressFieldProps {
  leg: "outbound" | "return";
  address: DeliveryAddress;
  onAddressChange: (address: string, latitude: number | null, longitude: number | null) => void;
  error: string | null;
  isLocating: boolean;
  onLocate: (onResolved: (found: MyLocation) => void) => void;
  /** Delivery area radius in km; null when the store sets no limit. */
  maximumDistance: number | null;
  pricePerKm: string;
}

/** Where the equipment is delivered to, or collected from. */
export const CheckoutDeliveryAddressField = ({
  leg,
  address,
  onAddressChange,
  error,
  isLocating,
  onLocate,
  maximumDistance,
  pricePerKm,
}: CheckoutDeliveryAddressFieldProps) => {
  const t = useTranslations("storefront.checkout");
  const fieldId = `fulfillment-${leg}-address`;
  const isOutbound = leg === "outbound";

  return (
    <div className="flex flex-col gap-2">
      <AddressInput
        id={fieldId}
        name={fieldId}
        ariaInvalid={Boolean(error)}
        value={address.address}
        latitude={address.latitude}
        longitude={address.longitude}
        onChange={onAddressChange}
        placeholder={isOutbound ? t("outboundAddressPlaceholder") : t("returnAddressPlaceholder")}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() =>
            onLocate((found) =>
              onAddressChange(
                found.address ?? `${found.latitude}, ${found.longitude}`,
                found.latitude,
                found.longitude,
              ),
            )
          }
          className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          {isLocating ? (
            <Loader2 aria-hidden className="size-3 motion-safe:animate-spin" />
          ) : (
            <Crosshair aria-hidden className="size-3" />
          )}
          {t("useMyLocation")}
        </button>

        {maximumDistance !== null ? (
          <span className="text-muted-foreground">
            {t("deliveryAreaSummary", { maxKm: maximumDistance, pricePerKm })}
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
};
