'use client'

import { Copy, Inbox, Mail, Send } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toastManager,
} from '@louez/ui'
import { cn } from '@louez/utils'

interface EmailContactPopoverProps {
  email: string
  className?: string
}

export const EmailContactPopover = ({ email, className }: EmailContactPopoverProps) => {
  const t = useTranslations('dashboard.emailContact')
  const encodedEmail = encodeURIComponent(email)

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email)
      toastManager.add({ title: t('copySuccess'), type: 'success' })
    } catch {
      toastManager.add({ title: t('copyError'), type: 'error' })
    }
  }

  const actions = [
    {
      key: 'default',
      href: `mailto:${email}`,
      icon: Mail,
      label: t('default'),
      tooltip: t('defaultTooltip'),
    },
    {
      key: 'gmail',
      href: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedEmail}`,
      icon: Send,
      label: t('gmail'),
      tooltip: t('gmailTooltip'),
    },
    {
      key: 'outlook',
      href: `https://outlook.office.com/mail/deeplink/compose?to=${encodedEmail}`,
      icon: Inbox,
      label: t('outlook'),
      tooltip: t('outlookTooltip'),
    },
  ]

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        {email}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1 *:p-0">
        <TooltipProvider>
          <div className="grid gap-1">
            {actions.map((action) => {
              const Icon = action.icon
              const isExternal = action.key !== 'default'

              return (
                <Tooltip key={action.key}>
                  <TooltipTrigger
                    className="flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                    render={
                      <a
                        href={action.href}
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noreferrer' : undefined}
                      />
                    }
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span>{action.label}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-64">
                    {action.tooltip}
                  </TooltipContent>
                </Tooltip>
              )
            })}
            <Tooltip>
              <TooltipTrigger
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                render={<button type="button" onClick={handleCopyEmail} />}
              >
                <Copy className="h-4 w-4 text-muted-foreground" />
                <span>{t('copy')}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                {t('copyTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  )
}
