"use client";

import { Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent } from "react";

import { Button, Input, Label } from "@louez/ui";
import { cn } from "@louez/utils";

import { displayLinkHref, normalizeLinkHref } from "@/lib/util.link-href";

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
  const [href, setHref] = useState(displayLinkHref(initialHref));
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
