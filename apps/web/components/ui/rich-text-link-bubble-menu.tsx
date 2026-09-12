"use client";

import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ExternalLink, Link as LinkIcon, Pencil, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { LinkForm, type LinkFormValue } from "@/components/ui/rich-text-link-form";
import { displayLinkHref } from "@/lib/util.link-href";

interface LinkBubbleMenuProps {
  editor: Editor;
  /** True while the address is being edited in place. */
  editing: boolean;
  onEdit: () => void;
  onSubmit: (value: LinkFormValue) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Stable across renders: the plugin is rebuilt when these change. */
const shouldShow: NonNullable<ComponentProps<typeof BubbleMenu>["shouldShow"]> = ({ editor }) =>
  editor.isEditable && editor.isActive("link");

const bubbleOptions: ComponentProps<typeof BubbleMenu>["options"] = {
  placement: "bottom-start",
  offset: 6,
  flip: true,
  shift: { padding: 8 },
};

/**
 * The bubble that follows the caret into a link: the address (opens in a
 * new tab), edit, remove. What Notion, Google Docs and Linear do, so a
 * link is never a mystery once it exists.
 */
export const LinkBubbleMenu = ({
  editor,
  editing,
  onEdit,
  onSubmit,
  onRemove,
  onCancel,
}: LinkBubbleMenuProps) => {
  const t = useTranslations("common.richTextEditor");
  const href: string = editor.getAttributes("link").href ?? "";

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubbleMenu"
      shouldShow={shouldShow}
      options={bubbleOptions}
      className={cn(
        // The plugin positions its own wrapper; this div must be positioned
        // too, or the z-index is ignored and the fields below paint over it.
        "relative z-50 rounded-lg border bg-popover text-popover-foreground shadow-md",
        editing
          ? "w-[calc(100vw-2rem)] max-w-80 p-3"
          : "flex max-w-[calc(100vw-2rem)] items-center gap-0.5 p-1",
      )}
      data-slot="link-bubble-menu"
    >
      {editing ? (
        <LinkForm
          key={href}
          initialHref={href}
          onSubmit={onSubmit}
          onRemove={onRemove}
          onCancel={onCancel}
        />
      ) : (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={t("openLink")}
          >
            <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-64 truncate">{displayLinkHref(href)}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </a>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            <Pencil />
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={t("removeLink")}
            title={t("removeLink")}
          >
            <Unlink />
          </Button>
        </>
      )}
    </BubbleMenu>
  );
};
