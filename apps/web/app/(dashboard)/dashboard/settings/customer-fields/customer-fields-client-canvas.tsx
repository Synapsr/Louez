"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { DisabledControlsProvider } from "@louez/ui";
import { resolveCustomerProfileSettings } from "@louez/validations";

import { resolvePreviewCheckoutFields } from "@/components/storefront/customer-fields/util.checkout-fields-preview";
import { useStore } from "@/contexts/store-context";
import { orpc } from "@/lib/orpc/react";
import { DEFAULT_STORE_THEME } from "@/lib/theme/util.store-theme";

import { CustomerFieldsAskPopover } from "./customer-fields-ask-popover";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsPreviewCheckout } from "./customer-fields-preview-checkout";
import { CustomerFieldsPreviewFrame } from "./customer-fields-preview-frame";
import { CustomerFieldsPreviewProductPicker } from "./customer-fields-preview-product-picker";
import { customerProfileSettingsOptions } from "./customer-fields.queries";
import { isSameCanvasField } from "./util.customer-field-canvas";
import { listActiveInFormOrder } from "./util.customer-fields-builder";

/** Until the native settings load, the preview asks none of them. */
const NO_PROFILE_SETTINGS = resolveCustomerProfileSettings(undefined);

/**
 * The checkout as a customer meets it, for one product or any, in the
 * store's colours. Resolved in the browser from the fields being edited, so
 * every change shows at once. A click on an asked field (Louez's or the
 * store's) opens its online settings; "Demander un champ au client" asks one more.
 */
export const CustomerFieldsClientCanvas = () => {
  const { storeName } = useStore();
  const { fields, settings, selection, selectField, readOnly } = useCustomerFieldsBuilder();
  const [productId, setProductId] = useState<string | null>(null);
  const { data: targetOptions } = useQuery(
    orpc.dashboard.customerFields.targetOptions.queryOptions(),
  );
  const { data: profileSettings } = useQuery(customerProfileSettingsOptions());

  // Only bookable products reach a checkout.
  const products = (targetOptions?.products ?? []).filter((product) => product.status === "active");
  const product = products.find((candidate) => candidate.id === productId) ?? null;
  const { profileFields, customerFields, itemFields } = resolvePreviewCheckoutFields(
    listActiveInFormOrder(fields),
    products,
    product?.id ?? null,
    profileSettings ?? NO_PROFILE_SETTINGS,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 @lg/canvas:flex-row @lg/canvas:items-end">
        {/* Looking at another product changes nothing: read-only members may too. */}
        <DisabledControlsProvider disabled={false}>
          <div className="min-w-0 flex-1">
            <CustomerFieldsPreviewProductPicker
              products={products}
              value={product?.id ?? null}
              onChange={setProductId}
            />
          </div>
        </DisabledControlsProvider>
        {!readOnly && <CustomerFieldsAskPopover />}
      </div>
      {/* The storefront look for everyone: its inputs are inert, never "disabled". */}
      <DisabledControlsProvider disabled={false}>
        <CustomerFieldsPreviewFrame
          storeName={storeName}
          theme={settings.storeTheme ?? DEFAULT_STORE_THEME}
        >
          <CustomerFieldsPreviewCheckout
            storeName={storeName}
            profileFields={profileFields}
            customerFields={customerFields}
            itemFields={itemFields}
            product={product ? { name: product.name, image: product.image } : null}
            isSelected={(field) => isSameCanvasField(selection, field)}
            onSelect={(field, event) =>
              selectField(field, { focus: "online", fromKeyboard: event.detail === 0 })
            }
            emptyAction={readOnly ? null : <CustomerFieldsAskPopover />}
          />
        </CustomerFieldsPreviewFrame>
      </DisabledControlsProvider>
    </div>
  );
};
