import type { EditorView } from "@tiptap/pm/view";

import { normalizeLinkHref } from "@/lib/util.link-href";

/** An e-mail address is not a web link; the storefront would drop `mailto:`. */
export const shouldAutoLink = (value: string): boolean => !value.includes("@");

/**
 * Pasting one address turns it into a link on the spot: over a selection
 * the selected words become the link, on an empty caret the address is
 * inserted as its own text. Anything else pastes as usual.
 */
export const pasteLink = (view: EditorView, event: ClipboardEvent): boolean => {
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  const href = normalizeLinkHref(pasted);
  if (!href) return false;

  const { state } = view;
  const linkType = state.schema.marks.link;
  if (!linkType) return false;

  const mark = linkType.create({ href });
  const tr = state.tr;
  if (state.selection.empty) {
    tr.replaceSelectionWith(state.schema.text(pasted.trim(), [mark]), false).removeStoredMark(
      linkType,
    );
  } else {
    tr.addMark(state.selection.from, state.selection.to, mark);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
};

/** The shortcut hint on the link button, on the viewer's keyboard. */
export const getModKeyLabel = (): string =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
