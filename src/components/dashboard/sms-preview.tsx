'use client'

import { cn } from '@/lib/utils'

interface SmsPreviewProps {
  message: string
  storeName: string
  className?: string
}

/**
 * Full phone simulator for SMS preview
 */
export function SmsPreview({ message, storeName, className }: SmsPreviewProps) {
  const charCount = message.length
  const segments = Math.ceil(charCount / 160) || 1

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Phone frame */}
      <div className="relative w-[280px] h-[500px] bg-gray-900 rounded-[40px] p-3 shadow-xl">
        {/* Screen */}
        <div className="w-full h-full bg-white rounded-[32px] overflow-hidden flex flex-col">
          {/* Status bar */}
          <div className="bg-gray-100 px-6 py-2 flex items-center justify-between">
            <span className="text-xs font-medium">9:41</span>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.01 21.49L23.64 7c-.45-.34-4.93-4-11.64-4C5.28 3 .81 6.66.36 7l11.63 14.49.01.01.01-.01z" />
              </svg>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 4h-3V2h-4v2H7v18h10V4z" />
              </svg>
            </div>
          </div>

          {/* Header */}
          <div className="bg-gray-100 px-4 py-3 border-b flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-primary">
                {storeName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{storeName}</p>
              <p className="text-xs text-muted-foreground">SMS</p>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 bg-gray-50 p-4 overflow-y-auto">
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-white rounded-2xl rounded-tl-md px-4 py-3 shadow-sm border">
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-right">Maintenant</p>
              </div>
            </div>
          </div>

          {/* Input area */}
          <div className="bg-white border-t px-4 py-3 flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full px-4 py-2">
              <span className="text-sm text-muted-foreground">Message</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Notch */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-900 rounded-b-2xl" />
      </div>

      {/* Character count */}
      <div className="mt-4 text-center">
        <p className={cn('text-sm font-medium', charCount > 160 ? 'text-amber-600' : 'text-muted-foreground')}>
          {charCount} / 160 caractères
        </p>
        {segments > 1 && (
          <p className="text-xs text-muted-foreground mt-1">{segments} SMS seront envoyés</p>
        )}
      </div>
    </div>
  )
}

/**
 * Compact SMS preview - simple message bubble without phone frame
 */
export function SmsPreviewCompact({ message, storeName, className }: SmsPreviewProps) {
  const charCount = message.length
  const segments = Math.ceil(charCount / 160) || 1

  return (
    <div className={cn('rounded-lg border bg-muted/30 overflow-hidden', className)}>
      {/* Header - simulates SMS app header */}
      <div className="bg-muted/50 px-4 py-2.5 border-b flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-primary">{storeName.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{storeName}</p>
        </div>
      </div>

      {/* Message area */}
      <div className="p-4 bg-gray-50/50">
        <div className="flex justify-start">
          <div className="max-w-[90%] bg-white rounded-2xl rounded-tl-md px-4 py-3 shadow-sm border">
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message}</p>
          </div>
        </div>
      </div>

      {/* Footer with char count */}
      <div className="px-4 py-2 bg-muted/30 border-t flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {segments > 1 ? `${segments} SMS` : '1 SMS'}
        </span>
        <span className={cn('text-xs', charCount > 160 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
          {charCount} / 160
        </span>
      </div>
    </div>
  )
}

/**
 * Utility to replace SMS template variables with example values
 */
export function replaceSmsVariables(
  template: string,
  values: {
    storeName: string
    number: string
    startDate: string
    endDate: string
  }
): string {
  return template
    .replace(/\{storeName\}/g, values.storeName)
    .replace(/\{number\}/g, values.number)
    .replace(/\{startDate\}/g, values.startDate)
    .replace(/\{endDate\}/g, values.endDate)
}
