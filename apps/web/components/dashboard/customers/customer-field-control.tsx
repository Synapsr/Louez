"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@louez/ui";
import { hasSuspiciousIdentityValue } from "@louez/validations";

import { PhoneInput } from "@/components/ui/phone-input";

import { CustomerFieldDuplicateHint } from "./customer-field-duplicate-hint";

type ControlDefinition = Pick<
  CustomerFieldDefinition,
  | "id"
  | "label"
  | "type"
  | "format"
  | "options"
  | "unit"
  | "helpText"
  | "isRequired"
  | "isSensitive"
  | "isSearchable"
>;

interface CustomerFieldControlProps {
  definition: ControlDefinition;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Already-translated error, when the server or the form refused the value. */
  error?: string;
  /** Record being edited, left out of the duplicate lookup. */
  customerId?: string;
  /** Disables the duplicate lookup, e.g. in the editor preview. */
  preview?: boolean;
  /** Needed when the same field is rendered several times on one page (one block per rented unit). */
  inputId?: string;
}

const getInputType = (type: ControlDefinition["type"]) =>
  type === "email" || type === "url" || type === "date" ? type : "text";

const getInputMode = (type: ControlDefinition["type"]) => {
  if (type === "number") return "decimal";
  if (type === "email" || type === "url") return type;
  return undefined;
};

/** The input of one custom field, whatever form library holds its value. */
export const CustomerFieldControl = ({
  definition,
  value,
  onChange,
  onBlur,
  error,
  customerId,
  preview = false,
  inputId,
}: CustomerFieldControlProps) => {
  const t = useTranslations("dashboard.customers.fields");
  const id = inputId ?? `custom-field-${definition.id}`;
  const label = definition.isRequired ? `${definition.label} *` : definition.label;
  const sensitive = definition.isSensitive ? { "data-openreplay-obscured": true } : {};

  if (definition.type === "checkbox") {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={id}>{label}</Label>
          {definition.helpText && (
            <p className="text-muted-foreground text-sm">{definition.helpText}</p>
          )}
        </div>
        <Switch
          id={id}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "")}
        />
      </div>
    );
  }

  const renderInput = () => {
    switch (definition.type) {
      case "textarea":
        return (
          <Textarea
            id={id}
            rows={3}
            value={value}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            {...sensitive}
          />
        );
      case "select": {
        const options = definition.options ?? [];
        return (
          <Select
            items={options.map((option) => ({ value: option, label: option }))}
            value={value || null}
            onValueChange={(next) => onChange(next ?? "")}
          >
            <SelectTrigger id={id} aria-invalid={Boolean(error)}>
              <SelectValue placeholder={t("selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option} label={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case "phone":
        return (
          <PhoneInput
            id={id}
            value={value}
            aria-invalid={Boolean(error)}
            onChange={onChange}
            onBlur={onBlur}
          />
        );
      default:
        return (
          <div className="relative">
            <Input
              id={id}
              value={value}
              type={getInputType(definition.type)}
              inputMode={getInputMode(definition.type)}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              className={definition.unit ? "pr-12" : undefined}
              onChange={(event) => onChange(event.target.value)}
              onBlur={onBlur}
              {...sensitive}
            />
            {definition.unit && (
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
                {definition.unit}
              </span>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} data-error={Boolean(error)}>
        {label}
      </Label>
      {renderInput()}
      {definition.helpText && !error && (
        <p className="text-muted-foreground text-sm">{definition.helpText}</p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!error && hasSuspiciousIdentityValue(definition.format, value) && (
        <p className="flex items-start gap-1.5 text-sm">
          <TriangleAlert
            aria-hidden
            className="text-badge-warning-foreground mt-0.5 size-4 shrink-0"
          />
          {t("suspicious")}
        </p>
      )}
      {!preview && definition.isSearchable && (
        <CustomerFieldDuplicateHint
          definitionId={definition.id}
          value={value}
          customerId={customerId}
        />
      )}
    </div>
  );
};
