"use client";

import { useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  DisabledControlsProvider,
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@louez/ui";
import { resolveCustomerProfileSettings } from "@louez/validations";

import { resolvePreviewCheckoutFields } from "@/components/storefront/customer-fields/util.checkout-fields-preview";
import { useStore } from "@/contexts/store-context";
import { DEFAULT_STORE_THEME } from "@/lib/theme/util.store-theme";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsPreviewCheckout } from "./customer-fields-preview-checkout";
import { CustomerFieldsPreviewFrame } from "./customer-fields-preview-frame";
import { CustomerFieldsPreviewProductPicker } from "./customer-fields-preview-product-picker";
import { customerFieldTargetOptions } from "./customer-fields.queries";
import { toPreviewCheckoutInput } from "./util.customer-form-builder";

/** Until the native settings load, the preview asks none of them. */
const NO_PROFILE_SETTINGS = resolveCustomerProfileSettings(undefined);

/**
 * "Aperçu client": the checkout as a customer meets it, for one product or
 * any, in the store's colours. Read from the lists being edited, so a change
 * made a second ago already shows. Nothing in it can be changed, so every
 * member may open it.
 */
export const CustomerFieldsPreviewSheet = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.preview");
  const { storeName } = useStore();
  const { previewOpen, setPreviewOpen, items, profileSettings, settings } =
    useCustomerFieldsBuilder();
  const [productId, setProductId] = useState<string | null>(null);
  // Focus lands on the Sheet, not in the product search: no keyboard popping up on a phone,
  // and Escape closes it right away.
  const popupRef = useRef<HTMLDivElement>(null);
  const { data: targetOptions } = useQuery({
    ...customerFieldTargetOptions(),
    enabled: previewOpen,
  });

  // Only bookable products reach a checkout.
  const products = (targetOptions?.products ?? []).filter((product) => product.status === "active");
  const product = products.find((candidate) => candidate.id === productId) ?? null;
  const customer = toPreviewCheckoutInput(items.customer);
  const item = toPreviewCheckoutInput(items.item);
  const { profileFields, customerFields, customerLayout, itemFields } =
    resolvePreviewCheckoutFields(
      [...customer.definitions, ...item.definitions],
      products,
      product?.id ?? null,
      profileSettings ?? NO_PROFILE_SETTINGS,
      customer.layout,
    );

  return (
    <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
      {/* Looking changes nothing: read-only members keep every control here. */}
      <DisabledControlsProvider disabled={false}>
        <SheetPopup
          ref={popupRef}
          initialFocus={popupRef}
          side="right"
          className="max-sm:w-full max-sm:max-w-none sm:max-w-lg"
        >
          <SheetHeader className="pe-14">
            <SheetTitle>{t("open")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          <SheetPanel className="flex flex-col gap-4">
            <CustomerFieldsPreviewProductPicker
              products={products}
              value={product?.id ?? null}
              onChange={setProductId}
            />
            <CustomerFieldsPreviewFrame
              storeName={storeName}
              theme={settings.storeTheme ?? DEFAULT_STORE_THEME}
            >
              <CustomerFieldsPreviewCheckout
                storeName={storeName}
                profileFields={profileFields}
                customerFields={customerFields}
                customerLayout={customerLayout}
                itemFields={itemFields}
                product={product ? { name: product.name, image: product.image } : null}
              />
            </CustomerFieldsPreviewFrame>
          </SheetPanel>
        </SheetPopup>
      </DisabledControlsProvider>
    </Sheet>
  );
};
