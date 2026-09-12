"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";
import {
  Button,
  Toggle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ScrollArea,
} from "@louez/ui";
import { useState, useCallback, useEffect, useRef } from "react";

import {
  LinkBubbleMenu,
  LinkForm,
  type LinkFormValue,
} from "@/components/ui/rich-text-editor-link";
import { normalizeLinkHref } from "@/lib/util.link-href";

interface RichTextEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const toolbarSkeletonGroups = [
  { key: "formatting", buttons: ["bold", "italic"] },
  { key: "lists", buttons: ["bullet", "ordered"] },
  { key: "blocks", buttons: ["quote", "separator"] },
  { key: "links", buttons: ["link"] },
] as const;

/** An e-mail address is not a web link; the storefront would drop `mailto:`. */
const shouldAutoLink = (value: string): boolean => !value.includes("@");

/**
 * Pasting one address turns it into a link on the spot: over a selection
 * the selected words become the link, on an empty caret the address is
 * inserted as its own text. Anything else pastes as usual.
 */
const pasteLink = (view: EditorView, event: ClipboardEvent): boolean => {
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
const getModKeyLabel = (): string =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export const RichTextEditor = ({
  value = "",
  onChange,
  placeholder,
  className,
  disabled = false,
}: RichTextEditorProps) => {
  const t = useTranslations("common.richTextEditor");
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkEditing, setLinkEditing] = useState(false);
  /** Read by ProseMirror handlers created once, so they see the latest closure. */
  const openLinkEditorRef = useRef<() => void>(() => {});

  const actualPlaceholder = placeholder || t("placeholder");
  const containerClassName = cn(
    "border-input bg-background relative w-full min-w-0 max-w-full overflow-x-clip rounded-md border",
    "focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2",
    disabled && "opacity-50",
    className,
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false,
        code: false,
        // Handled below: the built-in Link extension is configured on its own.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: false,
        defaultProtocol: "https",
        shouldAutoLink,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
        },
      }),
      Placeholder.configure({
        placeholder: actualPlaceholder,
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    // The toolbar and the link bubble read the selection on every render.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // Return empty string if only contains empty paragraph
      const isEmpty = html === "<p></p>" || html === "";
      onChange?.(isEmpty ? "" : html);
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none",
          "min-h-[120px] w-full rounded-md bg-transparent px-3 py-2",
          "focus:outline-none",
          "[overflow-wrap:anywhere] [&_*]:min-w-0",
          "prose-p:my-2 prose-ul:my-2 prose-ol:my-2",
          "prose-li:my-0",
          "prose-h1:text-2xl prose-h1:font-bold prose-h1:mt-4 prose-h1:mb-2",
          "prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-3 prose-h2:mb-2",
          "prose-h3:text-lg prose-h3:font-medium prose-h3:mt-2 prose-h3:mb-1",
          "prose-blockquote:border-l-4 prose-blockquote:border-primary/50 prose-blockquote:pl-4 prose-blockquote:italic",
          "prose-a:break-all",
          disabled && "opacity-50 cursor-not-allowed",
        ),
      },
      handleKeyDown: (_view, event) => {
        // Mod+K opens the link editor, and must not reach the dashboard's
        // command palette, which listens on the document for the same keys.
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          event.stopPropagation();
          openLinkEditorRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => (view.editable ? pasteLink(view, event) : false),
      handleClick: (_view, _pos, event) => {
        // Mod+click follows the link, as in most editors; a plain click
        // places the caret and lets the bubble show the address.
        if (!(event.metaKey || event.ctrlKey)) return false;
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return false;
        window.open(anchor.href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
  });

  // Sync external value changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  const openLinkEditor = useCallback(() => {
    if (!editor || disabled) return;
    if (editor.isActive("link")) {
      // Already a link: edit it where it is, in the bubble under the text.
      editor.chain().focus().extendMarkRange("link").run();
      setLinkEditing(true);
      return;
    }
    setLinkPopoverOpen(true);
  }, [editor, disabled]);

  useEffect(() => {
    openLinkEditorRef.current = openLinkEditor;
  }, [openLinkEditor]);

  const closeLinkEditors = useCallback(() => {
    setLinkPopoverOpen(false);
    setLinkEditing(false);
    editor?.commands.focus();
  }, [editor]);

  const applyLink = useCallback(
    ({ href, text }: LinkFormValue) => {
      if (!editor) return;
      const chain = editor.chain().focus();
      if (text !== undefined) {
        chain
          .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
          .unsetMark("link")
          .run();
      } else {
        chain.extendMarkRange("link").setLink({ href }).run();
      }
      setLinkPopoverOpen(false);
      setLinkEditing(false);
    },
    [editor],
  );

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkPopoverOpen(false);
    setLinkEditing(false);
  }, [editor]);

  if (!editor) {
    return (
      <div className={containerClassName} aria-hidden="true">
        <ScrollArea scrollFade className="h-auto w-full min-w-0 border-b">
          <div className="flex w-max min-w-full touch-pan-x flex-nowrap items-center gap-1 p-1">
            <div className="border-border flex shrink-0 items-center border-r pr-2">
              <div className="bg-muted h-9 w-14 rounded-lg sm:h-8" />
            </div>
            {toolbarSkeletonGroups.map(({ key, buttons }) => (
              <div
                key={key}
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  key !== "links" && "border-border border-r pr-2",
                )}
              >
                {buttons.map((button) => (
                  <div key={button} className="bg-muted size-9 rounded-lg sm:size-8" />
                ))}
              </div>
            ))}
            <div className="border-border ml-auto flex shrink-0 items-center gap-1 border-l pl-2">
              <div className="bg-muted size-9 rounded-lg sm:size-8" />
              <div className="bg-muted size-9 rounded-lg sm:size-8" />
            </div>
          </div>
        </ScrollArea>
        <div className="min-h-[120px]" />
      </div>
    );
  }

  const isOnLink = editor.isActive("link");
  const hasSelection = !editor.state.selection.empty;
  const headingLabel = editor.isActive("heading", { level: 1 })
    ? "H1"
    : editor.isActive("heading", { level: 2 })
      ? "H2"
      : editor.isActive("heading", { level: 3 })
        ? "H3"
        : t("text");

  return (
    <div className={containerClassName}>
      {/* Toolbar */}
      <ScrollArea scrollFade className="h-auto w-full min-w-0 border-b">
        <div
          className="flex w-max min-w-full touch-pan-x flex-nowrap items-center gap-1 p-1"
          role="toolbar"
        >
          {/* Heading dropdown */}
          <div className="border-border flex shrink-0 items-center border-r pr-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 min-w-14 px-2 text-xs sm:h-8"
                    disabled={disabled}
                    aria-label={t("heading")}
                  />
                }
              >
                {headingLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().setParagraph().run()}
                  className={editor.isActive("paragraph") ? "bg-accent" : ""}
                >
                  {t("normalText")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  className={editor.isActive("heading", { level: 1 }) ? "bg-accent" : ""}
                >
                  <Heading1 className="mr-2 h-4 w-4" />
                  {t("heading1")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className={editor.isActive("heading", { level: 2 }) ? "bg-accent" : ""}
                >
                  <Heading2 className="mr-2 h-4 w-4" />
                  {t("heading2")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  className={editor.isActive("heading", { level: 3 }) ? "bg-accent" : ""}
                >
                  <Heading3 className="mr-2 h-4 w-4" />
                  {t("heading3")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="border-border flex shrink-0 items-center gap-1 border-r pr-2">
            <Toggle
              pressed={editor.isActive("bold")}
              onPressedChange={() => editor.chain().focus().toggleBold().run()}
              disabled={disabled}
              aria-label={t("bold")}
            >
              <Bold className="h-4 w-4" />
            </Toggle>

            <Toggle
              pressed={editor.isActive("italic")}
              onPressedChange={() => editor.chain().focus().toggleItalic().run()}
              disabled={disabled}
              aria-label={t("italic")}
            >
              <Italic className="h-4 w-4" />
            </Toggle>
          </div>

          <div className="border-border flex shrink-0 items-center gap-1 border-r pr-2">
            <Toggle
              pressed={editor.isActive("bulletList")}
              onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
              disabled={disabled}
              aria-label={t("bulletList")}
            >
              <List className="h-4 w-4" />
            </Toggle>

            <Toggle
              pressed={editor.isActive("orderedList")}
              onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
              disabled={disabled}
              aria-label={t("orderedList")}
            >
              <ListOrdered className="h-4 w-4" />
            </Toggle>
          </div>

          <div className="border-border flex shrink-0 items-center gap-1 border-r pr-2">
            <Toggle
              pressed={editor.isActive("blockquote")}
              onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
              disabled={disabled}
              aria-label={t("quote")}
            >
              <Quote className="h-4 w-4" />
            </Toggle>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              disabled={disabled}
              aria-label={t("separator")}
              title={t("separator")}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Popover
              open={linkPopoverOpen}
              onOpenChange={(open) => {
                if (open && editor.isActive("link")) {
                  // The bubble under the link takes over for an existing link.
                  openLinkEditor();
                  return;
                }
                setLinkPopoverOpen(open);
              }}
            >
              <PopoverTrigger
                render={
                  <Toggle
                    pressed={isOnLink}
                    disabled={disabled}
                    aria-label={isOnLink ? t("editLink") : t("addLink")}
                    title={`${isOnLink ? t("editLink") : t("addLink")} (${getModKeyLabel()}K)`}
                  />
                }
              >
                <LinkIcon className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] max-w-80 p-3" align="start">
                {linkPopoverOpen ? (
                  <LinkForm
                    withText={!hasSelection}
                    onSubmit={applyLink}
                    onCancel={closeLinkEditors}
                  />
                ) : null}
              </PopoverContent>
            </Popover>
          </div>

          <div className="border-border ml-auto flex shrink-0 items-center gap-1 border-l pl-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={disabled || !editor.can().undo()}
              aria-label={t("undo")}
            >
              <Undo className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={disabled || !editor.can().redo()}
              aria-label={t("redo")}
            >
              <Redo className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </ScrollArea>

      {/* Editor */}
      <EditorContent editor={editor} />

      <LinkBubbleMenu
        editor={editor}
        editing={linkEditing}
        onEdit={openLinkEditor}
        onSubmit={applyLink}
        onRemove={removeLink}
        onCancel={closeLinkEditors}
      />

      {/* Styles for placeholder */}
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
        }
        .is-editor-empty::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
};
