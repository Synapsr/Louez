"use client";

import { ArrowRight, MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Button } from "@louez/ui";
import { cn } from "@louez/utils";
import type { CheckoutProfileField, CustomerExtraLayoutItem } from "@louez/validations";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { CustomerExtraFieldsGrid } from "@/components/storefront/customer-fields/customer-extra-fields-grid";
import { CustomerFieldInput } from "@/components/storefront/customer-fields/customer-field-input";
import { ProfileFieldPreview } from "@/components/storefront/customer-fields/profile-field-preview";
import { RentalUnitCard } from "@/components/storefront/customer-fields/rental-unit-card";
import { RentalUnitParticipantField } from "@/components/storefront/customer-fields/rental-unit-participant-field";
import { joinCustomerExtraLayout } from "@/components/storefront/customer-fields/util.customer-extra-layout";

import { CustomerFieldsPreviewContact } from "./customer-fields-preview-contact";

interface CustomerFieldsPreviewCheckoutProps {
  storeName: string;
  /** Native fields asked (birth date, source, links). */
  profileFields: CheckoutProfileField[];
  customerFields: CustomerFieldDefinition[];
  /** How the contact step lays the asked fields out, native and custom interleaved. */
  customerLayout: CustomerExtraLayoutItem[];
  itemFields: CustomerFieldDefinition[];
  /** The picked product, shown on the sample item card; null for "Tous les produits". */
  product: { name: string; image: string | null } | null;
}

/** The inputs are there to be looked at: nothing to type in the preview. */
const ignoreChange = () => undefined;

/**
 * The checkout's own blocks, with the storefront's components: the contact
 * step with the store's questions in the owner's layout, then one card of
 * "Détails de la location". What the owner sees is what the customer gets.
 */
export const CustomerFieldsPreviewCheckout = ({
  storeName,
  profileFields,
  customerFields,
  customerLayout,
  itemFields,
  product,
}: CustomerFieldsPreviewCheckoutProps) => {
  const t = useTranslations("storefront.checkout");
  const tPreview = useTranslations("dashboard.settings.customerFields.preview.client");
  const extraItems = joinCustomerExtraLayout(customerLayout, profileFields, customerFields);
  const isEmpty = extraItems.length === 0 && itemFields.length === 0;

  return (
    <>
      <div inert className="flex flex-col gap-4">
        <CustomerFieldsPreviewContact />
        <CustomerExtraFieldsGrid
          className="pt-2"
          items={extraItems}
          renderItem={(item) =>
            item.kind === "builtin" ? (
              <ProfileFieldPreview field={item.field} idPrefix="preview" />
            ) : (
              <CustomerFieldInput
                field={item.field}
                id={`preview-${item.field.id}`}
                value=""
                onChange={ignoreChange}
              />
            )
          }
        />
      </div>

      {itemFields.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold leading-tight tracking-tight">
              {t("steps.details")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("customFields.detailsIntro", { store: storeName })}
            </p>
          </div>
          <RentalUnitCard
            productName={product?.name ?? tPreview("sampleProduct")}
            productImage={product?.image ?? null}
            unitIndex={0}
            quantity={1}
          >
            <div inert className="grid items-start gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <RentalUnitParticipantField
                  id="preview-participant"
                  value=""
                  onChange={ignoreChange}
                />
              </div>
              {itemFields.map((field) => (
                <div
                  key={field.id}
                  className={cn("min-w-0", field.width === "full" && "sm:col-span-2")}
                >
                  <CustomerFieldInput
                    field={field}
                    id={`preview-unit-${field.id}`}
                    value=""
                    onChange={ignoreChange}
                  />
                </div>
              ))}
            </div>
          </RentalUnitCard>
          <p className="text-xs text-muted-foreground">{tPreview("oneCardPerUnit")}</p>
        </div>
      )}

      {isEmpty && (
        <div className="rounded-2xl border border-dashed">
          <DashboardEmptyState
            icon={MousePointerClick}
            title={product ? tPreview("emptyProduct") : tPreview("emptyAll")}
            description={tPreview("emptyHint")}
          />
        </div>
      )}

      <div inert>
        <Button type="button" size="lg" className="w-full">
          {t("continue")}
          <ArrowRight data-slot="icon" />
        </Button>
      </div>
    </>
  );
};
