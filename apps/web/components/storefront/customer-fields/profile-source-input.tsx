"use client";

import { useTranslations } from "next-intl";

import { CUSTOMER_ACQUISITION_SOURCES, type CustomerFieldCollectMode } from "@louez/types";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";
import { acquisitionSourceTakesDetail } from "@louez/validations";

import { CustomerFieldHints } from "./customer-field-hints";
import type { CustomerProfileFormValues } from "./customer-fields.types";
import { NO_PROFILE_FIELD_HINTS } from "./util.customer-profile-fields";

type SourceValue = CustomerProfileFormValues["acquisitionSource"];

interface ProfileSourceInputProps {
  collectMode: CustomerFieldCollectMode;
  /** DOM id of the select; the detail input takes `${id}-detail`. */
  id: string;
  value: SourceValue;
  onChange: (value: SourceValue) => void;
  onBlur?: () => void;
  /** Already-translated error. */
  error?: string;
}

/**
 * "Comment nous avez-vous connus ?": the same choices as the customer record,
 * and a "Précisez" line once the customer picks one that calls for it
 * (another way, a partner).
 */
export const ProfileSourceInput = ({
  collectMode,
  id,
  value,
  onChange,
  onBlur,
  error,
}: ProfileSourceInputProps) => {
  const t = useTranslations("storefront.customerFields");
  const tCustomers = useTranslations("dashboard.customers");
  const tFields = useTranslations("dashboard.customers.fields");
  const label = t("profile.acquisitionSource");
  const detailLabel = t("profile.acquisitionSourceDetail");
  const hintsId = `${id}-hints`;
  const detailId = `${id}-detail`;
  const items = CUSTOMER_ACQUISITION_SOURCES.map((source) => ({
    value: source,
    label: tCustomers(`sources.${source}`),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={id} data-error={Boolean(error)}>
          {collectMode === "required" ? label : t("optionalLabel", { label })}
        </Label>
        <Select
          items={items}
          value={value.source || null}
          onValueChange={(next) => onChange({ ...value, source: next ?? "" })}
        >
          <SelectTrigger
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? hintsId : undefined}
            onBlur={onBlur}
          >
            <SelectValue placeholder={tFields("selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} label={item.label}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CustomerFieldHints id={hintsId} field={NO_PROFILE_FIELD_HINTS} value="" error={error} />
      </div>
      {acquisitionSourceTakesDetail(value.source) && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={detailId}>{t("optionalLabel", { label: detailLabel })}</Label>
          <Input
            id={detailId}
            value={value.detail}
            maxLength={255}
            autoComplete="off"
            placeholder={tCustomers("form.acquisitionSourceDetailPlaceholder")}
            onChange={(event) => onChange({ ...value, detail: event.target.value })}
            onBlur={onBlur}
          />
        </div>
      )}
    </div>
  );
};
