"use client";

import { useState } from "react";
import { Globe, Undo2 } from "lucide-react";
import {
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Label,
} from "@louez/ui";

import { getFieldError } from "@/hooks/form/form-context";

type FormStoreNameSlugProps = {
  nameValue: string;
  nameErrors: unknown[];
  slugValue: string;
  slugErrors: unknown[];
  onNameChange: (nextValue: string) => void;
  onNameBlur: () => void;
  onSlugChange: (nextValue: string) => void;
  label: string;
  slugLabel: string;
  namePlaceholder: string;
  slugPlaceholder: string;
  domain: string;
  resetAriaLabel: string;
};

function slugifyStoreName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeSlugValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-/, "");
}

export function FormStoreNameSlug({
  nameValue,
  nameErrors,
  slugValue,
  slugErrors,
  onNameChange,
  onNameBlur,
  onSlugChange,
  label,
  slugLabel,
  namePlaceholder,
  slugPlaceholder,
  domain,
  resetAriaLabel,
}: FormStoreNameSlugProps) {
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

  const generatedSlug = slugifyStoreName(nameValue);
  const canResetSlug = nameValue.length > 0 && slugValue !== generatedSlug;

  const handleStoreNameChange = (value: string) => {
    onNameChange(value);

    if (isSlugManuallyEdited) return;

    onSlugChange(slugifyStoreName(value));
  };

  const handleSlugInputChange = (value: string) => {
    onSlugChange(sanitizeSlugValue(value));
    setIsSlugManuallyEdited(true);
  };

  const resetSlugToGeneratedValue = () => {
    setIsSlugManuallyEdited(false);
    onSlugChange(generatedSlug);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name" data-error={nameErrors.length > 0}>
          {label}
        </Label>
        <Input
          id="name"
          name="name"
          placeholder={namePlaceholder}
          value={nameValue}
          onChange={(e) => handleStoreNameChange(e.target.value)}
          onBlur={onNameBlur}
          aria-invalid={nameErrors.length > 0}
        />
        {nameErrors.length > 0 && (
          <p className="text-destructive text-sm">{getFieldError(nameErrors[0])}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug" data-error={slugErrors.length > 0}>
          {slugLabel}
        </Label>
        <InputGroup>
          <InputGroupAddon className="pr-2">
            <Globe />
          </InputGroupAddon>
          <InputGroupInput
            id="slug"
            name="slug"
            value={slugValue}
            onChange={(e) => handleSlugInputChange(e.target.value)}
            placeholder={slugPlaceholder}
            size={Math.max((slugValue || slugPlaceholder).length, 1)}
            className="max-w-full flex-none font-medium field-sizing-content"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={slugErrors.length > 0}
          />
          <InputGroupAddon align="inline-end" className="min-w-0 flex-1 justify-start">
            <InputGroupText className="select-none truncate">.{domain}</InputGroupText>
            {canResetSlug && (
              <InputGroupButton
                size="icon-xs"
                className="ml-auto"
                onClick={resetSlugToGeneratedValue}
                aria-label={resetAriaLabel}
                title={resetAriaLabel}
              >
                <Undo2 />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {slugErrors.length > 0 && (
          <p className="text-destructive text-sm">{getFieldError(slugErrors[0])}</p>
        )}
      </div>
    </div>
  );
}
