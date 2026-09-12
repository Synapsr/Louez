"use client";

import * as React from "react";

import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { useTrackedKeyboardHotkey } from "@/hooks/use-tracked-keyboard-shortcut";

type SearchInputProps = Omit<React.ComponentProps<typeof InputGroupInput>, "type"> & {
  clearLabel: string;
  enableShortcut?: boolean;
  groupClassName?: string;
  onClear?: () => void;
  showShortcutHint?: boolean;
};

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  ref.current = value;
}

function SearchInput(
  {
    className,
    clearLabel,
    enableShortcut = true,
    groupClassName,
    onChange,
    onClear,
    onKeyDown,
    showShortcutHint = true,
    value,
    ...props
  }: SearchInputProps,
  ref: React.Ref<HTMLInputElement>,
) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stringValue = typeof value === "string" ? value : (value?.toString() ?? "");
  const hasValue = stringValue.length > 0;
  const shortcut = useTrackedKeyboardHotkey(
    "search",
    () => {
      inputRef.current?.focus();
    },
    { enabled: enableShortcut },
  );

  const handleClear = () => {
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <InputGroup className={groupClassName}>
      <InputGroupInput
        ref={(node) => {
          inputRef.current = node;
          setRef(ref, node);
        }}
        type="search"
        value={value}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.blur();
          }
          onKeyDown?.(event);
        }}
        className={cn(className, "pl-1")}
        {...props}
      />
      <InputGroupAddon align="inline-start">
        <Search className="h-4 w-4" />
      </InputGroupAddon>
      {hasValue && (
        // No vertical padding: the button is taller than the shortcut hint and
        // would otherwise grow the field as soon as something is typed
        <InputGroupAddon align="inline-end" className="py-0">
          <InputGroupButton
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            aria-label={clearLabel}
          >
            <X className="h-4 w-4" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
      {!hasValue && showShortcutHint && enableShortcut && (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{shortcut.label}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

const ForwardedSearchInput = React.forwardRef(SearchInput);

export { ForwardedSearchInput as SearchInput, type SearchInputProps };
