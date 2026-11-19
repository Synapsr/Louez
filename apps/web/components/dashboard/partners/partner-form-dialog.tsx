"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  PARTNER_COMMISSION_TYPES,
  type Partner,
  type PartnerCommissionType,
} from "@louez/api/contracts/partners";
import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  SelectItem,
  toastManager,
} from "@louez/ui";
import { cn, getCurrencySymbol } from "@louez/utils";

import { useAppForm } from "@/hooks/form/form";
import { apiErrorKey } from "@/lib/orpc/errors";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

import { usePartnersAnalytics } from "./use-partners-analytics";

interface PartnerFormDialogProps {
  storeId: string;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The partner to edit; null adds one. */
  partner: Partner | null;
}

interface PartnerFormValues {
  name: string;
  commissionType: PartnerCommissionType;
  commissionValue: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const valuesOf = (partner: Partner | null): PartnerFormValues => ({
  name: partner?.name ?? "",
  commissionType: partner?.commission.type ?? "percent",
  commissionValue: partner ? String(partner.commission.value) : "10",
  contactName: partner?.contact.name ?? "",
  contactEmail: partner?.contact.email ?? "",
  contactPhone: partner?.contact.phone ?? "",
});

/** Adds a partner, or changes one: its name and commission first, its contact folded. */
export const PartnerFormDialog = ({
  storeId,
  currency,
  open,
  onOpenChange,
  partner,
}: PartnerFormDialogProps) => {
  const t = useTranslations("dashboard.partners.form");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const analytics = usePartnersAnalytics(storeId);
  const [contactOpen, setContactOpen] = useState(false);

  const schema = z
    .object({
      name: z.string().trim().min(1, t("nameRequired")).max(120),
      commissionType: z.enum(PARTNER_COMMISSION_TYPES),
      commissionValue: z.string(),
      contactName: z.string().max(120),
      contactEmail: z.union([z.literal(""), z.string().trim().email(t("emailInvalid"))]),
      contactPhone: z.string().max(40),
    })
    .superRefine((values, context) => {
      const value = Number(values.commissionValue.replace(",", "."));
      const max = values.commissionType === "percent" ? 100 : 100_000;
      if (!Number.isFinite(value) || value <= 0 || value > max) {
        context.addIssue({
          code: "custom",
          path: ["commissionValue"],
          message: values.commissionType === "percent" ? t("percentInvalid") : t("amountInvalid"),
        });
      }
    });

  const create = useMutation(partnersMutations.create());
  const update = useMutation(partnersMutations.update());

  const form = useAppForm({
    defaultValues: valuesOf(partner),
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const fields = {
        name: value.name.trim(),
        contactName: value.contactName,
        contactEmail: value.contactEmail,
        contactPhone: value.contactPhone,
        commission: {
          type: value.commissionType,
          value: Number(value.commissionValue.replace(",", ".")),
        },
      };
      try {
        if (partner) {
          await update.mutateAsync({ partnerId: partner.id, ...fields });
          await queryClient.invalidateQueries({ queryKey: partnersQueries.key() });
          onOpenChange(false);
          return;
        }
        const created = await create.mutateAsync(fields);
        analytics.created(created.commission.type);
        await queryClient.invalidateQueries({ queryKey: partnersQueries.key() });
        onOpenChange(false);
        router.push(`/dashboard/visibility/partners/${created.id}`);
      } catch (error) {
        const key = apiErrorKey(error);
        toastManager.add({
          title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
          type: "error",
        });
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset(valuesOf(partner));
        onOpenChange(next);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form.AppForm>
          <form.Form className="contents" formName={partner ? "partner-edit" : "partner-create"}>
            <DialogHeader>
              <DialogTitle>{partner ? t("titleEdit") : t("titleCreate")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <form.AppField name="name">
                {(field) => (
                  <field.Input label={t("name")} placeholder={t("namePlaceholder")} autoFocus />
                )}
              </form.AppField>
              <div className="grid grid-cols-[1fr_7rem] items-start gap-3">
                <form.AppField name="commissionType">
                  {(field) => (
                    <field.Select
                      label={t("commission")}
                      items={{ percent: t("types.percent"), fixed: t("types.fixed") }}
                    >
                      <SelectItem value="percent">{t("types.percent")}</SelectItem>
                      <SelectItem value="fixed">{t("types.fixed")}</SelectItem>
                    </field.Select>
                  )}
                </form.AppField>
                <form.Subscribe selector={(state) => state.values.commissionType}>
                  {(type) => (
                    <form.AppField name="commissionValue">
                      {(field) => (
                        <field.Input
                          label={type === "percent" ? t("rate") : t("amount")}
                          inputMode="decimal"
                          suffix={type === "percent" ? "%" : getCurrencySymbol(currency)}
                        />
                      )}
                    </form.AppField>
                  )}
                </form.Subscribe>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("baseHint")}
                {partner && ` ${t("rateChangeHint")}`}
              </p>

              <Collapsible open={contactOpen} onOpenChange={setContactOpen}>
                <CollapsibleTrigger
                  render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}
                >
                  <ChevronDown
                    className={cn("transition-transform", contactOpen && "rotate-180")}
                  />
                  {t("contact")}
                </CollapsibleTrigger>
                <CollapsiblePanel className="space-y-4 pt-2">
                  <form.AppField name="contactName">
                    {(field) => <field.Input label={t("contactName")} />}
                  </form.AppField>
                  <form.AppField name="contactEmail">
                    {(field) => <field.Input label={t("contactEmail")} type="email" />}
                  </form.AppField>
                  <form.AppField name="contactPhone">
                    {(field) => <field.Input label={t("contactPhone")} type="tel" />}
                  </form.AppField>
                </CollapsiblePanel>
              </Collapsible>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <form.SubscribeButton>{partner ? t("save") : t("create")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
