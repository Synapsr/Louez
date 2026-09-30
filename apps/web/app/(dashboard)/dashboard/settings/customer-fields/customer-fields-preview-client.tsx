"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { DisabledControlsProvider } from "@louez/ui";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { resolvePreviewCheckoutFields } from "@/components/storefront/customer-fields/util.checkout-fields-preview";
import { useStore } from "@/contexts/store-context";
import { orpc } from "@/lib/orpc/react";
import type { StoreThemeInput } from "@/lib/theme/util.store-theme";

import { CustomerFieldsPreviewCheckout } from "./customer-fields-preview-checkout";
import { CustomerFieldsPreviewFrame } from "./customer-fields-preview-frame";
import { CustomerFieldsPreviewProductPicker } from "./customer-fields-preview-product-picker";

interface CustomerFieldsPreviewClientProps {
  /** Active fields in the owner's order, both scopes. */
  definitions: CustomerFieldDefinition[];
  theme: StoreThemeInput;
}

/**
 * The checkout as a customer meets it, for one product or any. Resolved in
 * the browser from the fields being edited, so every switch, target and drag
 * shows at once, before anything is saved elsewhere.
 */
export const CustomerFieldsPreviewClient = ({
  definitions,
  theme,
}: CustomerFieldsPreviewClientProps) => {
  const t = useTranslations("dashboard.settings.customerFields.preview.client");
  const { storeName } = useStore();
  const [productId, setProductId] = useState<string | null>(null);
  const { data: targetOptions } = useQuery(
    orpc.dashboard.customerFields.targetOptions.queryOptions(),
  );

  // Only bookable products reach a checkout.
  const products = (targetOptions?.products ?? []).filter((product) => product.status === "active");
  const product = products.find((candidate) => candidate.id === productId) ?? null;
  const { customerFields, itemFields } = resolvePreviewCheckoutFields(
    definitions,
    products,
    product?.id ?? null,
  );
  const isEmpty = customerFields.length === 0 && itemFields.length === 0;

  return (
    // View-only controls: members without `manage_settings` may look too.
    <DisabledControlsProvider disabled={false}>
      <div className="flex flex-col gap-4">
        <CustomerFieldsPreviewProductPicker
          products={products}
          value={product?.id ?? null}
          onChange={setProductId}
        />
        {isEmpty ? (
          <DashboardEmptyState
            icon={MousePointerClick}
            title={product ? t("emptyProduct") : t("emptyAll")}
            description={t("emptyHint")}
            className="rounded-2xl border border-dashed"
          />
        ) : (
          <CustomerFieldsPreviewFrame storeName={storeName} theme={theme}>
            <CustomerFieldsPreviewCheckout
              storeName={storeName}
              customerFields={customerFields}
              itemFields={itemFields}
              product={product ? { name: product.name, image: product.image } : null}
            />
          </CustomerFieldsPreviewFrame>
        )}
      </div>
    </DisabledControlsProvider>
  );
};
