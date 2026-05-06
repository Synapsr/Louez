import type { RegisterableHotkey } from '@tanstack/react-hotkeys';

export const keyboardShortcuts = {
  search: {
    focus: {
      hotkey: 'Mod+F' satisfies RegisterableHotkey,
      label: '⌘F',
    },
  },
} as const;
