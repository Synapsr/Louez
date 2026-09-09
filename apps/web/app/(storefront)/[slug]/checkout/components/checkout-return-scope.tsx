"use client";

import { useTranslations } from "next-intl";

import { RadioGroup } from "@louez/ui";

import { CheckoutMethodOption } from "./checkout-method-option";

/** The three outcomes the return leg can have. */
export type ReturnScope = "same" | "location" | "address";

interface CheckoutReturnScopeProps {
  scope: ReturnScope;
  onScopeChange: (scope: ReturnScope) => void;
  isAddressDeliveryEnabled: boolean;
  isAddressDeliveryAvailable: boolean;
  /** Price shown on the address option, e.g. a per-km rate or "Free". */
  deliveryPrice: string;
  isDeliveryFree: boolean;
  isPickupAtAddress: boolean;
  /** Where "same place" resolves to, spelled out under the choice. */
  sameAsPickupSummary: string | null;
}

const isReturnScope = (value: unknown): value is ReturnScope =>
  value === "same" || value === "location" || value === "address";

/**
 * Where the equipment goes back, as one choice rather than two: whether it
 * returns to the pickup point at all, and if not, where instead.
 */
export const CheckoutReturnScope = ({
  scope,
  onScopeChange,
  isAddressDeliveryEnabled,
  isAddressDeliveryAvailable,
  deliveryPrice,
  isDeliveryFree,
  isPickupAtAddress,
  sameAsPickupSummary,
}: CheckoutReturnScopeProps) => {
  const t = useTranslations("storefront.checkout");

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        name="fulfillment-return-scope"
        aria-label={t("returnTitle")}
        value={scope}
        onValueChange={(value) => {
          if (isReturnScope(value)) onScopeChange(value);
        }}
        className="flex-col gap-1.5 sm:flex-row sm:flex-wrap"
      >
        <CheckoutMethodOption
          value="same"
          label={t("returnSamePlace")}
          price={isPickupAtAddress ? deliveryPrice : t("free")}
          isFree={!isPickupAtAddress || isDeliveryFree}
          isSelected={scope === "same"}
        />
        <CheckoutMethodOption
          value="location"
          label={t("returnAnotherLocation")}
          price={t("free")}
          isFree
          isSelected={scope === "location"}
        />
        {isAddressDeliveryEnabled ? (
          <CheckoutMethodOption
            value="address"
            label={t("returnMyAddress")}
            price={deliveryPrice}
            isFree={isDeliveryFree}
            isSelected={scope === "address"}
            isDisabled={!isAddressDeliveryAvailable}
          />
        ) : null}
      </RadioGroup>

      {scope === "same" && sameAsPickupSummary ? (
        <p className="text-xs text-muted-foreground">{sameAsPickupSummary}</p>
      ) : null}
    </div>
  );
};
