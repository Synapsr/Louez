"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { DisabledControlsProvider } from "@louez/ui";

import { resolvePreviewCheckoutFields } from "@/components/storefront/customer-fields/util.checkout-fields-preview";
import { useStore } from "@/contexts/store-context";
import { orpc } from "@/lib/orpc/react";
import { DEFAULT_STORE_THEME } from "@/lib/theme/util.store-theme";

import { CustomerFieldsAskPopover } from "./customer-fields-ask-popover";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsPreviewCheckout } from "./customer-fields-preview-checkout";
import { CustomerFieldsPreviewFrame } from "./customer-fields-preview-frame";
import { CustomerFieldsPreviewProductPicker } from "./customer-fields-preview-product-picker";
import { listActiveInFormOrder } from "./util.customer-fields-builder";

/**
 * The checkout as a customer meets it, for one product or any, in the
 * store's colours. Resolved in the browser from the fields being edited, so
 * every change shows at once. A click on an asked field opens its online
 * settings; "Demander un champ au client" asks one more.
 */
export const CustomerFieldsClientCanvas = () => {
  const { storeName } = useStore();
  const { fields, settings, selection, selectField, readOnly } = useCustomerFieldsBuilder();
  const [productId, setProductId] = useState<string | null>(null);
  const { data: targetOptions } = useQuery(
    orpc.dashboard.customerFields.targetOptions.queryOptions(),
  );

  // Only bookable products reach a checkout.
  const products = (targetOptions?.products ?? []).filter((product) => product.status === "active");
  const product = products.find((candidate) => candidate.id === productId) ?? null;
  const { customerFields, itemFields } = resolvePreviewCheckoutFields(
    listActiveInFormOrder(fields),
    products,
    product?.id ?? null,
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
            customerFields={customerFields}
            itemFields={itemFields}
            product={product ? { name: product.name, image: product.image } : null}
            selectedId={selection?.kind === "field" ? selection.id : null}
            onSelect={(fieldId) => selectField(fieldId, "online")}
            emptyAction={readOnly ? null : <CustomerFieldsAskPopover />}
          />
        </CustomerFieldsPreviewFrame>
      </DisabledControlsProvider>
    </div>
  );
};
