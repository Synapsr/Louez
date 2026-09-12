"use client";

import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ExternalLink, Link as LinkIcon, Pencil, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ComponentProps, type KeyboardEvent } from "react";

import { Button, Input, Label } from "@louez/ui";
import { cn } from "@louez/utils";

import { normalizeLinkHref } from "@/lib/util.link-href";

export interface LinkFormValue {
  href: string;
  /** Only set when the form asked for a text, i.e. nothing was selected. */
  text?: string;
}

interface LinkFormProps {
  /** Prefilled when an existing link is being edited. */
  initialHref?: string;
  /** Ask for the text too: nothing is selected, so the link needs one. */
  withText?: boolean;
  onSubmit: (value: LinkFormValue) => void;
  /** Present only when editing an existing link. */
  onRemove?: () => void;
  onCancel: () => void;
  className?: string;
}

/** Shown without the scheme, as browsers do in the address bar. */
const displayHref = (href: string): string => href.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/**
 * The one place a link's address is typed: the toolbar popover when adding
 * a link, the bubble under a link when editing it. Enter applies, Escape
 * cancels, a bare `exemple.fr` is accepted and gets `https://`.
 */
export const LinkForm = ({
  initialHref = "",
  withText = false,
  onSubmit,
  onRemove,
  onCancel,
  className,
}: LinkFormProps) => {
  const t = useTranslations("common.richTextEditor");
  const id = useId();
  const [href, setHref] = useState(displayHref(initialHref));
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    const normalized = normalizeLinkHref(href);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    onSubmit(
      withText ? { href: normalized, text: text.trim() || href.trim() } : { href: normalized },
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className={cn("grid gap-3", className)}>
      {withText ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-text`}>{t("linkText")}</Label>
          <Input
            id={`${id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("linkTextPlaceholder")}
            autoComplete="off"
          />
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-href`}>{t("linkUrl")}</Label>
        <Input
          id={`${id}-href`}
          value={href}
          onChange={(event) => {
            setHref(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("linkUrlPlaceholder")}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint`}
          autoFocus
        />
        <p
          id={`${id}-hint`}
          className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}
        >
          {invalid ? t("linkInvalid") : t("linkHint")}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="me-auto">
            <Unlink />
            {t("removeLink")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={submit}>
          {t("apply")}
        </Button>
      </div>
    </div>
  );
};

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
            <span className="max-w-64 truncate">{displayHref(href)}</span>
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
