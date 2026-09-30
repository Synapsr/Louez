"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { toCanvasFieldKey } from "./util.customer-field-canvas";
import { toDraftPreview } from "./util.customer-fields-builder";

const ignoreChange = () => undefined;

/**
 * The field being created, where it will land, following what is typed in
 * the inspector. Highlighted like a selected field, marked "Nouveau". The
 * workspace brings it into view (it may land below the fold).
 */
export const CustomerFieldDraftRow = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.field");
  const { draftForm } = useCustomerFieldsBuilder();
  const values = useStore(draftForm.store, (state) => state.values);

  return (
    <li
      data-canvas-field={toCanvasFieldKey({ kind: "draft" })}
      className="bg-primary/5 ring-primary/50 relative rounded-xl ring-2"
    >
      <div className="flex items-start gap-1 py-3 ps-1 pe-2">
        <span aria-hidden className="w-6 shrink-0" />
        <div inert className="min-w-0 flex-1">
          <CustomerFieldControl
            preview
            definition={toDraftPreview(values, t("draftPlaceholder"))}
            value=""
            inputId="canvas-draft"
            onChange={ignoreChange}
          />
        </div>
      </div>
      {/* A tag on the frame: clear of the input whatever its type (a yes/no box fills the row). */}
      <span className="bg-card absolute end-3 -top-2.5 rounded-sm">
        <Badge variant="info">{t("draftBadge")}</Badge>
      </span>
    </li>
  );
};
