"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Button } from "@louez/ui";

import { CustomerFieldInput } from "@/components/storefront/customer-fields/customer-field-input";
import { CustomerFieldSections } from "@/components/storefront/customer-fields/customer-field-sections";
import { RentalUnitCard } from "@/components/storefront/customer-fields/rental-unit-card";
import { RentalUnitParticipantField } from "@/components/storefront/customer-fields/rental-unit-participant-field";

interface CustomerFieldsPreviewCheckoutProps {
  storeName: string;
  customerFields: CustomerFieldDefinition[];
  itemFields: CustomerFieldDefinition[];
  /** The picked product, shown on the sample unit card; null for "Tous les produits". */
  product: { name: string; image: string | null } | null;
}

/** The inputs are inert in the frame: nothing to type, nothing to keep. */
const ignoreChange = () => undefined;

/**
 * The checkout's own blocks, as a phone shows them: the contact step's
 * questions under the usual contact fields, then one card of "Détails de la
 * location". Same components as the storefront, so what the owner sees is
 * what the customer gets.
 */
export const CustomerFieldsPreviewCheckout = ({
  storeName,
  customerFields,
  itemFields,
  product,
}: CustomerFieldsPreviewCheckoutProps) => {
  const t = useTranslations("storefront.checkout");
  const tPreview = useTranslations("dashboard.settings.customerFields.preview.client");

  return (
    <>
      {customerFields.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold leading-tight tracking-tight">
            {t("steps.contact")}
          </h2>
          {/* Stand-ins for e-mail, name and phone: the questions come after them. */}
          <div aria-hidden className="flex flex-col gap-2">
            <div className="h-9 rounded-lg bg-muted" />
            <div className="h-9 w-2/3 rounded-lg bg-muted" />
          </div>
          <CustomerFieldSections
            fields={customerFields}
            renderField={(field) => (
              <CustomerFieldInput
                field={field}
                id={`preview-${field.id}`}
                value=""
                onChange={ignoreChange}
              />
            )}
          />
        </div>
      )}

      {itemFields.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold leading-tight tracking-tight">
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
            <div className="flex flex-col gap-3">
              <RentalUnitParticipantField
                id="preview-participant"
                value=""
                onChange={ignoreChange}
              />
              {itemFields.map((field) => (
                <CustomerFieldInput
                  key={field.id}
                  field={field}
                  id={`preview-unit-${field.id}`}
                  value=""
                  onChange={ignoreChange}
                />
              ))}
            </div>
          </RentalUnitCard>
          <p className="text-xs text-muted-foreground">{tPreview("oneCardPerUnit")}</p>
        </div>
      )}

      <Button type="button" size="lg" className="w-full">
        {t("continue")}
        <ArrowRight data-slot="icon" />
      </Button>
    </>
  );
};
