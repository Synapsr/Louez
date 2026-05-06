'use client';

import * as React from 'react';
import { type RegisterableHotkey, useHotkey } from '@tanstack/react-hotkeys';

import { Search, X } from 'lucide-react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@louez/ui';

import { keyboardShortcuts } from '@/lib/keyboard-shortcuts';

type SearchInputProps = Omit<React.ComponentProps<typeof InputGroupInput>, 'type'> & {
  clearLabel: string;
  enableShortcut?: boolean;
  groupClassName?: string;
  onClear?: () => void;
  shortcutHotkey?: RegisterableHotkey;
  shortcutLabel?: string;
  showShortcutHint?: boolean;
};

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;

  if (typeof ref === 'function') {
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
    shortcutHotkey = keyboardShortcuts.search.focus.hotkey,
    shortcutLabel = keyboardShortcuts.search.focus.label,
    showShortcutHint = true,
    value,
    ...props
  }: SearchInputProps,
  ref: React.Ref<HTMLInputElement>,
) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stringValue = typeof value === 'string' ? value : value?.toString() ?? '';
  const hasValue = stringValue.length > 0;

  useHotkey(
    shortcutHotkey,
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
          if (event.key === 'Escape') {
            event.currentTarget.blur();
          }
          onKeyDown?.(event);
        }}
        className={className}
        {...props}
      />
      <InputGroupAddon align="inline-start">
        <Search className="h-4 w-4" />
      </InputGroupAddon>
      {hasValue && (
        <InputGroupAddon align="inline-end">
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
          <InputGroupText>{shortcutLabel}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

const ForwardedSearchInput = React.forwardRef(SearchInput);

export { ForwardedSearchInput as SearchInput, type SearchInputProps };
