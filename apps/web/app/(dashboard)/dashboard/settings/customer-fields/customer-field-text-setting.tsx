"use client";

import { useState } from "react";

import { Input, Label } from "@louez/ui";

interface CustomerFieldTextSettingProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  /**
   * `live` sends every keystroke (a field being created: its row follows);
   * `commit` sends on blur or Enter (a saved field: one save per edit).
   */
  mode: "live" | "commit";
  autoFocus?: boolean;
  error?: string;
  /** Returns false when the value is refused: the saved one comes back. */
  onChange: (value: string) => boolean | void;
}

/**
 * A text setting of the Sheet. Escape puts a saved field's edited text back
 * as it was, without closing the Sheet; with nothing to undo (or on a field
 * being created) it leaves the key to the Sheet, which closes.
 */
export const CustomerFieldTextSetting = ({
  id,
  label,
  value,
  placeholder,
  maxLength,
  mode,
  autoFocus,
  error,
  onChange,
}: CustomerFieldTextSettingProps) => {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  // A new value from outside (the save answered, a revert) replaces the text.
  if (value !== saved) {
    setSaved(value);
    setText(value);
  }

  const commit = () => {
    if (text === value) return;
    if (onChange(text) === false) setText(value);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} data-error={Boolean(error)}>
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          if (mode === "live") onChange(event.target.value);
        }}
        onBlur={mode === "commit" ? commit : undefined}
        onKeyDown={(event) => {
          if (mode !== "commit") return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape" && text !== value) {
            event.stopPropagation();
            setText(value);
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
};
