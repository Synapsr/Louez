"use client";

import { useState } from "react";

import { X } from "lucide-react";

import { Badge, Input, useControlsDisabled } from "@louez/ui";

interface CustomerFieldOptionsInputProps {
  id: string;
  value: string[];
  placeholder: string;
  invalid: boolean;
  onChange: (options: string[]) => void;
}

/** Choices of a list field, typed one at a time and shown as removable chips. */
export const CustomerFieldOptionsInput = ({
  id,
  value,
  placeholder,
  invalid,
  onChange,
}: CustomerFieldOptionsInputProps) => {
  const [draft, setDraft] = useState("");
  // The chips' remove buttons are plain buttons: read-only settings must hide them too.
  const readOnly = useControlsDisabled();

  const commit = () => {
    const option = draft.trim();
    if (option && !value.includes(option)) onChange([...value, option]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((option) => (
            <li key={option}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {option}
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={option}
                    className="hover:bg-background/60 rounded-lg p-0.5"
                    onClick={() => onChange(value.filter((entry) => entry !== option))}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
};
