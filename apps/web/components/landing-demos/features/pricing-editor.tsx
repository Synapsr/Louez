"use client";

import { useState } from "react";
import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { ProductFormStepPricing } from "@/app/(dashboard)/dashboard/products/components/product-form-step-pricing";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { useAppForm } from "@/hooks/form/form";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import { createDemoPricingSeasons, createDemoPricingValues } from "@/lib/landing-demos/pricing";

/** The edit-page heading and its real pricing card, without media or product mutations. */
export const PricingEditor = ({ period }: Pick<FeatureSceneProps, "period">) => {
  const locale = useDemoLocale();
  const t = useTranslations("dashboard.products");
  const tBreadcrumbs = useTranslations("dashboard.breadcrumbs");
  const [seasons] = useState(() => createDemoPricingSeasons(period, locale));
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: createDemoPricingValues(locale),
    onSubmit: () => undefined,
  });
  const values = useStore(form.store, (state) => state.values);

  return (
    <DashboardSceneFrame page="products" pathname="/dashboard/products/demo-city-bike/edit">
      <div className="space-y-6" data-demo-target="pricing-editor">
        <DashboardBreadcrumbLabel
          pathname="/dashboard/products/demo-city-bike"
          label={values.name}
        />
        <DashboardBreadcrumbLabel label={tBreadcrumbs("productsEdit")} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("editProduct")}</h1>
          <p className="text-muted-foreground">{t("editProductDescription")}</p>
        </div>
        <form.AppForm>
          <ProductFormStepPricing
            form={form}
            watchedValues={values}
            currency="EUR"
            currencySymbol="€"
            storeTimezone={DEMO_RULES.timezone}
            isSaving={false}
            availableAccessories={[]}
            showStock={false}
            showAccessories={false}
            productId="demo-city-bike"
            seasonalPricings={seasons}
            selectedSeasonalPeriodId={selectedSeason}
            onSelectSeasonalPeriod={setSelectedSeason}
            readOnly
            autoFocus={false}
          />
        </form.AppForm>
      </div>
    </DashboardSceneFrame>
  );
};
