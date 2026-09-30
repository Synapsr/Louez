"use client";

import { Building2, Lock, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, DisabledControlsProvider, Input } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

const ignoreChange = () => undefined;

/** Locked inputs read as such: muted, the label inside. */
const LOCKED_INPUT = "bg-muted/60";

/**
 * The contact block every customer has, as a compact sketch of the team's
 * form: there to read the form from the top, never to edit. Greyed and out
 * of the tab order, so the owner's own fields get the room.
 */
export const CustomerFieldsLockedCard = () => {
  const t = useTranslations("dashboard.customers");
  const tBuilder = useTranslations("dashboard.settings.customerFields.builder.locked");

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold leading-snug">{tBuilder("title")}</h3>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Lock aria-hidden className="size-3.5" />
          {tBuilder("note")}
        </span>
      </div>
      <DisabledControlsProvider disabled>
        <div inert className="grid gap-2.5">
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
          <div className="grid grid-cols-2 gap-2.5">
            <Input
              aria-label={t("form.firstName")}
              placeholder={t("form.firstName")}
              className={LOCKED_INPUT}
            />
            <Input
              aria-label={t("form.lastName")}
              placeholder={t("form.lastName")}
              className={LOCKED_INPUT}
            />
            <Input
              aria-label={t("form.email")}
              placeholder={t("form.email")}
              className={LOCKED_INPUT}
            />
            <Input
              aria-label={t("form.phone")}
              placeholder={t("form.phone")}
              className={LOCKED_INPUT}
            />
          </div>
          <Input
            aria-label={t("form.address")}
            placeholder={t("form.address")}
            className={LOCKED_INPUT}
          />
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            {tBuilder("company")}
          </p>
        </div>
      </DisabledControlsProvider>
    </Card>
  );
};
