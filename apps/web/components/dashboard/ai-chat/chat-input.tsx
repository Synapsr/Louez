'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { ArrowUp, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { cn } from '@louez/utils'

type ChatInputProps = {
  onSend: (text: string) => void
  isLoading: boolean
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const t = useTranslations('dashboard.aiChat')
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep focus on textarea
  useEffect(() => {
    const el = textareaRef.current
    if (el && !isLoading) {
      el.focus()
    }
  }, [isLoading])

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    onSend(input.trim())
    setInput('')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasInput = input.trim().length > 0

  return (
    <div
      className={cn(
        'mx-3 mb-3 flex items-center gap-2 rounded-xl border px-3 py-2',
        'transition-all duration-200',
        'focus-within:border-primary/30 focus-within:shadow-[0_0_0_3px] focus-within:shadow-primary/5',
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary/40" />
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('placeholder')}
        disabled={isLoading}
        autoFocus
        rows={1}
        className={cn(
          'field-sizing-content min-h-[40px] max-h-[120px] flex-1 resize-none bg-transparent text-sm',
          'placeholder:text-muted-foreground outline-none disabled:opacity-50',
        )}
      />
      <Button
        type="button"
        size="icon"
        className={cn(
          'h-8 w-8 shrink-0 rounded-lg transition-all duration-200',
          hasInput && !isLoading
            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
            : '',
        )}
        disabled={!hasInput || isLoading}
        onClick={handleSend}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  )
}
