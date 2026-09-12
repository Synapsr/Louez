import { z } from "zod";

export const createProductPromotionSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string = (key) =>
    `validation.${key}`,
) =>
  z
    .object({
      percentage: z
        .number()
        .int(t("integer"))
        .min(1, t("minValue", { min: 1 }))
        .max(99, t("maxValue", { max: 99 })),
      startsOn: z.iso.date(t("date")).nullable(),
      endsOn: z.iso.date(t("date")).nullable(),
    })
    .refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, {
      message: t("endDateBeforeStart"),
      path: ["endsOn"],
    });

export const productPromotionSchema = createProductPromotionSchema();
