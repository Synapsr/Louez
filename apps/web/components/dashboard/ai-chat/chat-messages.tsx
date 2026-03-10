'use client'

import type { UIMessage } from '@ai-sdk/react'
import { Sparkles } from 'lucide-react'

import { cn } from '@louez/utils'

type ChatMessagesProps = {
  messages: UIMessage[]
  isLoading: boolean
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  return (
    <div className="space-y-4 pb-2">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            'flex',
            message.role === 'user' ? 'justify-end' : 'justify-start',
          )}
        >
          {message.role === 'assistant' && (
            <div className="mr-2.5 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
          )}
          <div
            className={cn(
              'max-w-[80%] text-sm leading-relaxed',
              message.role === 'user'
                ? 'rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground'
                : 'text-foreground pt-0.5',
            )}
          >
            <MessageParts parts={message.parts} />
          </div>
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex items-start">
          <div className="mr-2.5 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-3 w-3 text-primary animate-pulse" />
          </div>
          <span className="flex gap-1.5 pt-2.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
          </span>
        </div>
      )}
    </div>
  )
}

function MessageParts({ parts }: { parts: UIMessage['parts'] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <TextContent key={i} text={part.text} />
        }
        return null
      })}
    </>
  )
}

/** Render inline formatting: **bold**, `code`, *italic* */
function InlineFormat({ text }: { text: string }) {
  // Split on **bold**, `code`, and *italic* (in order of priority)
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|\*[^*]+\*)/)
  return (
    <>
      {parts.map((segment, j) => {
        if (segment.startsWith('**') && segment.endsWith('**')) {
          return <strong key={j} className="font-semibold">{segment.slice(2, -2)}</strong>
        }
        if (segment.startsWith('`') && segment.endsWith('`')) {
          return (
            <code key={j} className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[12px] text-primary">
              {segment.slice(1, -1)}
            </code>
          )
        }
        if (segment.startsWith('*') && segment.endsWith('*') && segment.length > 2) {
          return <em key={j}>{segment.slice(1, -1)}</em>
        }
        return segment
      })}
    </>
  )
}

function TextContent({ text }: { text: string }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' = 'ul'
  let listStart = 0

  const flushList = () => {
    if (listItems.length === 0) return
    const Tag = listType
    elements.push(
      <Tag
        key={`list-${listStart}`}
        className={cn(
          'my-1.5 ml-4 space-y-1 marker:text-primary/40',
          listType === 'ul' ? 'list-disc' : 'list-decimal',
        )}
      >
        {listItems.map((item, j) => (
          <li key={j}>
            <InlineFormat text={item} />
          </li>
        ))}
      </Tag>,
    )
    listItems = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Empty line
    if (!trimmed) {
      flushList()
      elements.push(<br key={i} />)
      continue
    }

    // Headers: ## or ###
    const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headerMatch) {
      flushList()
      const level = headerMatch[1].length
      const content = headerMatch[2]
      const className =
        level === 1
          ? 'text-sm font-semibold mt-3 mb-1'
          : level === 2
            ? 'text-[13px] font-semibold mt-2.5 mb-1 text-primary/90'
            : 'text-xs font-medium mt-2 mb-0.5 text-muted-foreground uppercase tracking-wide'
      elements.push(
        <p key={i} className={className}>
          <InlineFormat text={content} />
        </p>,
      )
      continue
    }

    // Unordered list: - item or * item
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (ulMatch) {
      if (listItems.length === 0) { listStart = i; listType = 'ul' }
      listItems.push(ulMatch[1])
      continue
    }

    // Ordered list: 1. item
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/)
    if (olMatch) {
      if (listItems.length === 0) { listStart = i; listType = 'ol' }
      listItems.push(olMatch[1])
      continue
    }

    // Regular paragraph
    flushList()
    elements.push(
      <p key={i}>
        <InlineFormat text={trimmed} />
      </p>,
    )
  }

  flushList()

  return <div className="space-y-1">{elements}</div>
}
