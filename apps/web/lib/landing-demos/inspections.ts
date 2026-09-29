import type { ComponentProps } from "react";

import type { InspectionWizard } from "@/app/(dashboard)/dashboard/reservations/[id]/inspection/[type]/components/inspection-wizard";
import type { ComparisonView } from "@/app/(dashboard)/dashboard/reservations/[id]/inspection/compare/comparison-view";
import type { InspectionSettingsForm } from "@/app/(dashboard)/dashboard/settings/inspections/inspection-settings-form";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";
import { getInspectionDemoText } from "@/lib/landing-demos/text.inspections";

type WizardProps = ComponentProps<typeof InspectionWizard>;
type ComparisonProps = ComponentProps<typeof ComparisonView>;

export const createDemoInspectionWizard = (
  locale: Locale = defaultLocale,
  notedItemIndex = 0,
): WizardProps => {
  const product = getDemoProducts(locale)[0];
  const customer = getDemoCustomer(0);
  const text = getInspectionDemoText(locale);
  const items: WizardProps["items"] = [0, 1].map((index) => ({
    id: `demo-inspection-item-${index}`,
    reservationItemId: "demo-line-0",
    quantity: 1,
    productUnitId: `demo-bike-unit-${index}`,
    unitIdentifier: `V-00${index + 1}`,
    product: { id: product.id, name: product.name, images: [...(product.images ?? [])] },
  }));
  const initialInspections: NonNullable<WizardProps["initialInspections"]> = {};
  for (const [index, item] of items.entries()) {
    initialInspections[item.id] = {
      condition: "ok",
      notes: index === notedItemIndex ? text.wearNote : "",
      photos: item.product.images.slice(0, 1).map((url, photoIndex) => ({
        id: `demo-inspection-photo-${index}-${photoIndex}`,
        key: `demo-inspections/${index}/${photoIndex}`,
        url,
      })),
    };
  }
  return {
    reservationId: "demo-reservation-0",
    reservationNumber: "1042",
    customerName: `${customer.firstName} ${customer.lastName}`,
    type: "departure",
    items,
    requireSignature: true,
    maxPhotosPerItem: 1,
    initialInspections,
    readOnly: true,
  };
};

export const createDemoInspectionComparison = (
  period: RentalPeriodValue,
  locale: Locale = defaultLocale,
): ComparisonProps => {
  const wizard = createDemoInspectionWizard(locale);
  const text = getInspectionDemoText(locale);
  // A family hire keeps the real comparison page tall enough to scroll on desktop.
  const products = getDemoProducts(locale).slice(0, 4);
  const returnedAt = getDemoToday(period);
  returnedAt.setHours(17, 0, 0, 0);
  const departedAt = new Date(returnedAt);
  departedAt.setDate(departedAt.getDate() - 2);
  departedAt.setHours(9, 0, 0, 0);

  const makeInspection = (
    type: "departure" | "return",
  ): NonNullable<ComparisonProps["departure"]> => {
    const isReturn = type === "return";
    const createdAt = isReturn ? returnedAt : departedAt;
    return {
      id: `demo-${type}-inspection`,
      type,
      status: "signed",
      hasDamage: isReturn,
      notes: isReturn ? text.returnNote : text.departureNote,
      createdAt,
      signedAt: new Date(createdAt.getTime() + 5 * 60_000),
      hasSignature: true,
      items: products.map((product, index) => ({
        id: `${type}-demo-inspection-item-${index}`,
        productName: product.name,
        unitIdentifier: `V-00${index + 1}`,
        condition: isReturn && index === 1 ? "damaged" : "good",
        notes: isReturn && index === 1 ? text.damageNote : null,
        photos: (product.images ?? []).map((url, photoIndex) => ({
          id: `demo-inspection-photo-${index}-${photoIndex}`,
          url,
          thumbnailUrl: null,
          caption: isReturn && index === 1 ? text.damageNote : text.departureNote,
        })),
      })),
    };
  };
  return {
    reservationId: wizard.reservationId,
    reservationNumber: wizard.reservationNumber,
    customerName: wizard.customerName,
    departure: makeInspection("departure"),
    return_: makeInspection("return"),
    readOnly: true,
  };
};

export const DEMO_INSPECTION_STORE = {
  id: "demo-store",
  settings: {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    inspection: {
      enabled: true,
      mode: "recommended",
      requireCustomerSignature: true,
      autoGeneratePdf: true,
      maxPhotosPerItem: 10,
    },
  },
} satisfies ComponentProps<typeof InspectionSettingsForm>["store"];
