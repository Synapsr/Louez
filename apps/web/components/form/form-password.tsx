"use client";

import { useState } from "react";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Label } from "@louez/ui";
import { EyeIcon } from "@louez/ui/icons";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

import { PasswordRulesChecklist } from "./password-rules-checklist";

interface FormPasswordProps {
  label?: string;
  placeholder?: string;
  /** `new-password` for a password being chosen, `current-password` to sign in. */
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  /** Shows the live rule checklist — only where a password is being chosen. */
  showRules?: boolean;
  /** Applied to the input group, e.g. a taller control on the login screen. */
  className?: string;
}

/**
 * Password field with a show/hide toggle. There is deliberately no
 * confirmation field anywhere in the product: seeing what was typed is a
 * better guard against typos than typing it blind twice.
 */
export const FormPassword = ({
  label,
  placeholder,
  autoComplete,
  autoFocus,
  showRules = false,
  className,
}: FormPasswordProps) => {
  const t = useTranslations("auth");
  const field = useFieldContext<string>();
  const [isVisible, setIsVisible] = useState(false);
  const errors = field.state.meta.errors;
  const error = errors[0];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <InputGroup className={className}>
        <InputGroupInput
          id={field.name}
          name={field.name}
          type={isVisible ? "text" : "password"}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={errors.length > 0}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={isVisible ? t("hidePassword") : t("showPassword")}
            aria-pressed={isVisible}
            onClick={() => setIsVisible((visible) => !visible)}
          >
            {isVisible ? <EyeOff /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {showRules && <PasswordRulesChecklist password={field.state.value} />}
      {error && <p className="text-destructive text-sm">{getFieldError(error)}</p>}
    </div>
  );
};
