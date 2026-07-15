import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

export const keyboardShortcuts = {
  commandPalette: {
    open: {
      hotkey: "Mod+K" satisfies RegisterableHotkey,
      label: "⌘K",
    },
    ai: {
      hotkey: "Mod+Shift+K" satisfies RegisterableHotkey,
      label: "⌘⇧K",
    },
  },
  search: {
    focus: {
      hotkey: "Mod+F" satisfies RegisterableHotkey,
      label: "⌘F",
    },
  },
} as const;
