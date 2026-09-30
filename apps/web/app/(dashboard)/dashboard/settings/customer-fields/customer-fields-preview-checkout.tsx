"use client";

import type { MouseEvent, ReactNode } from "react";

import { ArrowRight, MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Button } from "@louez/ui";
import type { CheckoutProfileField } from "@louez/validations";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { CustomerFieldInput } from "@/components/storefront/customer-fields/customer-field-input";
import { CustomerFieldSections } from "@/components/storefront/customer-fields/customer-field-sections";
import { ProfileFieldPreview } from "@/components/storefront/customer-fields/profile-field-preview";
import { ProfileFieldsSection } from "@/components/storefront/customer-fields/profile-fields-section";
import { RentalUnitCard } from "@/components/storefront/customer-fields/rental-unit-card";
import { RentalUnitParticipantField } from "@/components/storefront/customer-fields/rental-unit-participant-field";

import { CustomerFieldsClientField } from "./customer-fields-client-field";
import { CustomerFieldsPreviewContact } from "./customer-fields-preview-contact";
import { type CanvasFieldRef, toCanvasFieldKey } from "./util.customer-field-canvas";

interface CustomerFieldsPreviewCheckoutProps {
  storeName: string;
  /** Native fields asked (birth date, source, links): the "Profil" group, before the store's own. */
  profileFields: CheckoutProfileField[];
  customerFields: CustomerFieldDefinition[];
  itemFields: CustomerFieldDefinition[];
  /** The picked product, shown on the sample unit card; null for "Tous les produits". */
  product: { name: string; image: string | null } | null;
  isSelected: (field: CanvasFieldRef) => boolean;
  onSelect: (field: CanvasFieldRef, event: MouseEvent<HTMLButtonElement>) => void;
  /** When nothing is asked for this product: the way to ask something. */
  emptyAction: ReactNode;
}

/** The inputs are there to be looked at: nothing to type in the preview. */
const ignoreChange = () => undefined;

/**
 * The checkout's own blocks, as a phone shows them: the contact step with
 * the questions under the usual fields (Louez's profile ones, then the
 * store's), then one card of "Détails de la location". Same components as the
 * storefront, so what the owner sees is what the customer gets; each asked
 * field, Louez's or the store's, opens its settings.
 */
export const CustomerFieldsPreviewCheckout = ({
  storeName,
  profileFields,
  customerFields,
  itemFields,
  product,
  isSelected,
  onSelect,
  emptyAction,
}: CustomerFieldsPreviewCheckoutProps) => {
  const t = useTranslations("storefront.checkout");
  const tFields = useTranslations("storefront.customerFields.profile");
  const tPreview = useTranslations("dashboard.settings.customerFields.preview.client");
  const isEmpty =
    profileFields.length === 0 && customerFields.length === 0 && itemFields.length === 0;

  const renderField = (field: CustomerFieldDefinition, idPrefix: string) => {
    const ref: CanvasFieldRef = { kind: "field", id: field.id };
    return (
      <CustomerFieldsClientField
        canvasKey={toCanvasFieldKey(ref)}
        label={field.label}
        selected={isSelected(ref)}
        onSelect={(event) => onSelect(ref, event)}
      >
        <CustomerFieldInput
          field={field}
          id={`${idPrefix}-${field.id}`}
          value=""
          onChange={ignoreChange}
        />
      </CustomerFieldsClientField>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <CustomerFieldsPreviewContact />
        {(profileFields.length > 0 || customerFields.length > 0) && (
          <div className="flex flex-col gap-6 pt-2">
            {profileFields.length > 0 && (
              <ProfileFieldsSection>
                {profileFields.map((field) => {
                  const ref: CanvasFieldRef = { kind: "profile", key: field.key };
                  return (
                    <CustomerFieldsClientField
                      key={field.key}
                      canvasKey={toCanvasFieldKey(ref)}
                      label={tFields(field.key)}
                      selected={isSelected(ref)}
                      onSelect={(event) => onSelect(ref, event)}
                    >
                      <ProfileFieldPreview field={field} idPrefix="preview" />
                    </CustomerFieldsClientField>
                  );
                })}
              </ProfileFieldsSection>
            )}
            <CustomerFieldSections
              fields={customerFields}
              renderField={(field) => renderField(field, "preview")}
            />
          </div>
        )}
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
            <div className="flex flex-col gap-2">
              <div inert className="pb-1">
                <RentalUnitParticipantField
                  id="preview-participant"
                  value=""
                  onChange={ignoreChange}
                />
              </div>
              {itemFields.map((field) => (
                <div key={field.id}>{renderField(field, "preview-unit")}</div>
              ))}
            </div>
          </RentalUnitCard>
          <p className="text-xs text-muted-foreground">{tPreview("oneCardPerUnit")}</p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed pb-5">
          <DashboardEmptyState
            icon={MousePointerClick}
            title={product ? tPreview("emptyProduct") : tPreview("emptyAll")}
            description={tPreview("emptyHint")}
            className="pb-0"
          />
          {emptyAction}
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
