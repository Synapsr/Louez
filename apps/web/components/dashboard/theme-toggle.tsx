'use client'

import * as React from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'

import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'

const themes = [
  { value: 'light', icon: Sun, labelKey: 'light' },
  { value: 'dark', icon: Moon, labelKey: 'dark' },
  { value: 'system', icon: Monitor, labelKey: 'system' },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations('dashboard.theme')
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex items-center justify-center gap-1 rounded-lg border bg-muted/50 p-1">
        {themes.map((item) => (
          <div
            key={item.value}
            className="h-8 w-8 rounded-md"
          />
        ))}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex items-center justify-center gap-1 rounded-lg border bg-muted/50 p-1">
        {themes.map((item) => {
          const Icon = item.icon
          const isActive = theme === item.value

          return (
            <Tooltip key={item.value}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-8 w-8 transition-all',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setTheme(item.value)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="sr-only">{t(item.labelKey)}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t(item.labelKey)}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
