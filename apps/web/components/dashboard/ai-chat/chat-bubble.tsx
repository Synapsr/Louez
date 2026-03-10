'use client'

import { useEffect, useState } from 'react'

import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@louez/utils'

import { ChatModal } from './chat-modal'

export function ChatBubble() {
  const [open, setOpen] = useState(false)
  const t = useTranslations('dashboard.aiChat')

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center lg:left-64">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'pointer-events-auto group relative flex items-center gap-2.5 rounded-full',
            'border border-primary/20 bg-background/80 px-5 py-2.5 text-sm backdrop-blur-xl',
            'text-muted-foreground transition-all duration-300',
            'hover:text-foreground hover:border-primary/40 hover:bg-background/95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            // Constant subtle glow, amplified on hover
            'shadow-[0_0_20px_-5px] shadow-primary/15',
            'hover:shadow-[0_0_30px_-5px] hover:shadow-primary/30',
            // Pulse animation on the glow
            'animate-[ai-glow_4s_ease-in-out_infinite]',
          )}
        >
          <Sparkles className="h-4 w-4 text-primary transition-transform group-hover:scale-110" />
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {t('badge')}
          </span>
          <span className="hidden sm:inline">{t('placeholder')}</span>
          <kbd className="bg-muted text-muted-foreground/70 ml-2 hidden rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline-block">
            ⌘K
          </kbd>
        </button>
      </div>

      <ChatModal open={open} onOpenChange={setOpen} />
    </>
  )
}
