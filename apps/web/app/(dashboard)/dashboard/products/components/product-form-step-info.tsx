"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { ProductInfoFields, type ProductInfoFieldsProps } from "./product-info-fields";

type ProductFormStepInfoProps = ProductInfoFieldsProps;

export function ProductFormStepInfo(props: ProductFormStepInfoProps) {
  const t = useTranslations("dashboard.products.form");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("information")}</CardTitle>
        <CardDescription>{t("informationDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ProductInfoFields {...props} />
      </CardContent>
    </Card>
  );
}
