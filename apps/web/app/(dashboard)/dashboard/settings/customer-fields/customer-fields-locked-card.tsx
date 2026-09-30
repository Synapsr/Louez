"use client";

import { Building2, Lock, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, DisabledControlsProvider, Input } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { CustomerFieldLockedCell } from "./customer-field-locked-cell";

const ignoreChange = () => undefined;

/** Locked inputs read as such: muted. */
const LOCKED_INPUT = "bg-muted/60";

/**
 * The contact block every customer has, drawn like the rest of the form (a
 * label above each input) but locked: there to read the form from the top,
 * never to edit. Out of the tab order, so the owner's own fields get the room.
 */
export const CustomerFieldsLockedCard = () => {
  const t = useTranslations("dashboard.customers");
  const tBuilder = useTranslations("dashboard.settings.customerFields.builder.locked");

  return (
    <Card className="gap-2 p-3 sm:p-4">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 ps-1">
        <h3 className="text-base font-semibold leading-snug">{tBuilder("title")}</h3>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Lock aria-hidden className="size-3.5" />
          {tBuilder("note")}
        </span>
      </div>
      <DisabledControlsProvider disabled>
        {/* Indented like the rows below (past the drag handle's room), so every label lines up. */}
        <div inert className="flex flex-col gap-5 py-3 ps-8 pe-2">
          <CustomerFieldLockedCell label={t("form.customerKind")}>
            <div className="@md/canvas:max-w-xs">
              <PanelSegmentedControl
                aria-label={t("form.customerKind")}
                value="individual"
                onChange={ignoreChange}
                options={[
                  { value: "individual", label: t("customerType.individual"), icon: User },
                  { value: "business", label: t("customerType.business"), icon: Building2 },
                ]}
              />
            </div>
          </CustomerFieldLockedCell>
          <div className="grid gap-x-3 gap-y-5 @sm/canvas:grid-cols-2">
            <CustomerFieldLockedCell label={t("form.firstName")}>
              <Input aria-label={t("form.firstName")} className={LOCKED_INPUT} />
            </CustomerFieldLockedCell>
            <CustomerFieldLockedCell label={t("form.lastName")}>
              <Input aria-label={t("form.lastName")} className={LOCKED_INPUT} />
            </CustomerFieldLockedCell>
            <CustomerFieldLockedCell label={t("form.email")}>
              <Input aria-label={t("form.email")} className={LOCKED_INPUT} />
            </CustomerFieldLockedCell>
            <CustomerFieldLockedCell label={t("form.phone")}>
              <Input aria-label={t("form.phone")} className={LOCKED_INPUT} />
            </CustomerFieldLockedCell>
          </div>
          <CustomerFieldLockedCell label={t("form.address")}>
            <Input
              aria-label={t("form.address")}
              placeholder={tBuilder("addressPlaceholder")}
              className={LOCKED_INPUT}
            />
          </CustomerFieldLockedCell>
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            {tBuilder("company")}
          </p>
        </div>
      </DisabledControlsProvider>
    </Card>
  );
};
