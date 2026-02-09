'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Unlink,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@louez/utils'
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
  Input,
} from '@louez/ui'
import { useState, useCallback, useEffect } from 'react'

interface RichTextEditorProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function RichTextEditor({
  value = '',
  onChange,
  placeholder,
  className,
  disabled = false,
}: RichTextEditorProps) {
  const t = useTranslations('common.richTextEditor')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)

  const actualPlaceholder = placeholder || t('placeholder')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false,
        code: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      Placeholder.configure({
        placeholder: actualPlaceholder,
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      // Return empty string if only contains empty paragraph
      const isEmpty = html === '<p></p>' || html === ''
      onChange?.(isEmpty ? '' : html)
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none',
          'min-h-[120px] w-full rounded-md bg-transparent px-3 py-2',
          'focus:outline-none',
          'prose-p:my-2 prose-ul:my-2 prose-ol:my-2',
          'prose-li:my-0',
          'prose-h1:text-2xl prose-h1:font-bold prose-h1:mt-4 prose-h1:mb-2',
          'prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-3 prose-h2:mb-2',
          'prose-h3:text-lg prose-h3:font-medium prose-h3:mt-2 prose-h3:mb-1',
          'prose-blockquote:border-l-4 prose-blockquote:border-primary/50 prose-blockquote:pl-4 prose-blockquote:italic',
          disabled && 'opacity-50 cursor-not-allowed'
        ),
      },
    },
  })

  // Sync external value changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value)
    }
  }, [value, editor])

  const setLink = useCallback(() => {
    if (!linkUrl) {
      editor?.chain().focus().unsetLink().run()
      return
    }

    // Add https if no protocol
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
    editor?.chain().focus().setLink({ href: url }).run()
    setLinkUrl('')
    setLinkPopoverOpen(false)
  }, [editor, linkUrl])

  if (!editor) {
    return null
  }

  return (
    <div
      className={cn(
        'border-input bg-background rounded-md border',
        'focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2',
        disabled && 'opacity-50',
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b p-1">
        {/* Heading dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={disabled}
            />}>
              {editor.isActive('heading', { level: 1 })
                ? 'H1'
                : editor.isActive('heading', { level: 2 })
                  ? 'H2'
                  : editor.isActive('heading', { level: 3 })
                    ? 'H3'
                    : 'Texte'}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => editor.chain().focus().setParagraph().run()}
              className={editor.isActive('paragraph') ? 'bg-accent' : ''}
            >
              Texte normal
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={editor.isActive('heading', { level: 1 }) ? 'bg-accent' : ''}
            >
              <Heading1 className="mr-2 h-4 w-4" />
              Titre 1
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={editor.isActive('heading', { level: 2 }) ? 'bg-accent' : ''}
            >
              <Heading2 className="mr-2 h-4 w-4" />
              Titre 2
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={editor.isActive('heading', { level: 3 }) ? 'bg-accent' : ''}
            >
              <Heading3 className="mr-2 h-4 w-4" />
              Titre 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="bg-border mx-1 h-6 w-px" />

        <Toggle
          size="sm"
          pressed={editor.isActive('bold')}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled}
          aria-label={t('bold')}
        >
          <Bold className="h-4 w-4" />
        </Toggle>

        <Toggle
          size="sm"
          pressed={editor.isActive('italic')}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled}
          aria-label={t('italic')}
        >
          <Italic className="h-4 w-4" />
        </Toggle>

        <div className="bg-border mx-1 h-6 w-px" />

        <Toggle
          size="sm"
          pressed={editor.isActive('bulletList')}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled}
          aria-label={t('bulletList')}
        >
          <List className="h-4 w-4" />
        </Toggle>

        <Toggle
          size="sm"
          pressed={editor.isActive('orderedList')}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled}
          aria-label={t('orderedList')}
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>

        <div className="bg-border mx-1 h-6 w-px" />

        <Toggle
          size="sm"
          pressed={editor.isActive('blockquote')}
          onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
          disabled={disabled}
          aria-label={t('quote')}
        >
          <Quote className="h-4 w-4" />
        </Toggle>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={disabled}
          className="h-8 w-8 p-0"
          title={t('separator')}
        >
          <Minus className="h-4 w-4" />
        </Button>

        <div className="bg-border mx-1 h-6 w-px" />

        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <PopoverTrigger render={<Toggle
              size="sm"
              pressed={editor.isActive('link')}
              disabled={disabled}
              aria-label={t('addLink')}
            />}>
              <LinkIcon className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setLink()}
              />
              <Button size="sm" onClick={setLink}>
                OK
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {editor.isActive('link') && (
          <Toggle
            size="sm"
            pressed={false}
            onPressedChange={() => editor.chain().focus().unsetLink().run()}
            disabled={disabled}
            aria-label={t('removeLink')}
          >
            <Unlink className="h-4 w-4" />
          </Toggle>
        )}

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
          className="h-8 w-8 p-0"
        >
          <Undo className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
          className="h-8 w-8 p-0"
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

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
  )
}
