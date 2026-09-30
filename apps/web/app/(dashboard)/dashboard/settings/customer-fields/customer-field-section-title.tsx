"use client";

import { useState } from "react";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@louez/ui";

interface CustomerFieldSectionTitleProps {
  name: string;
  editing: boolean;
  /** False for read-only members: the title is just a title. */
  editable: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (name: string) => void;
}

/**
 * A section's title, renamed where it stands: a click turns it into a field,
 * Enter or leaving keeps the new name, Escape keeps the old one.
 */
export const CustomerFieldSectionTitle = ({
  name,
  editing,
  editable,
  onEditingChange,
  onRename,
}: CustomerFieldSectionTitleProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const [text, setText] = useState(name);
  const [wasEditing, setWasEditing] = useState(editing);
  // Each edit starts from the current name, however it was opened (click, menu, new section).
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setText(name);
  }

  const commit = () => {
    const next = text.trim();
    onEditingChange(false);
    if (next && next !== name) onRename(next);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={t("sections.rename")}
        value={text}
        maxLength={100}
        className="text-base font-semibold"
        onFocus={(event) => event.target.select()}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            onEditingChange(false);
          }
        }}
      />
    );
  }

  if (!editable) {
    return <h3 className="min-w-0 truncate text-base font-semibold leading-snug">{name}</h3>;
  }

  return (
    <h3 className="min-w-0 text-base font-semibold leading-snug">
      <button
        type="button"
        title={t("builder.sections.renameHint")}
        className="group/title hover:bg-muted focus-visible:ring-ring -mx-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left outline-none focus-visible:ring-2"
        onClick={() => onEditingChange(true)}
      >
        <span className="truncate">{name}</span>
        <Pencil
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
        />
      </button>
    </h3>
  );
};
