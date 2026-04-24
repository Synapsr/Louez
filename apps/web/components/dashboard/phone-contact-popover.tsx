'use client'

import { MessageCircle, MessageSquare, Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'

interface PhoneContactPopoverProps {
  phone: string
  className?: string
}

function normalizeForWhatsApp(phone: string) {
  return phone.replace(/[^\d]/g, '')
}

export function PhoneContactPopover({ phone, className }: PhoneContactPopoverProps) {
  const t = useTranslations('dashboard.phoneContact')
  const whatsappPhone = normalizeForWhatsApp(phone)

  const actions = [
    {
      key: 'call',
      href: `tel:${phone}`,
      icon: Phone,
      label: t('call'),
      tooltip: t('callTooltip'),
    },
    ...(whatsappPhone
      ? [
          {
            key: 'whatsapp',
            href: `https://wa.me/${whatsappPhone}`,
            icon: MessageCircle,
            label: t('whatsapp'),
            tooltip: t('whatsappTooltip'),
          },
        ]
      : []),
    {
      key: 'sms',
      href: `sms:${phone}`,
      icon: MessageSquare,
      label: t('sms'),
      tooltip: t('smsTooltip'),
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
        {phone}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1 *:p-0">
        <TooltipProvider>
          <div className="grid gap-1">
            {actions.map((action) => {
              const Icon = action.icon

              return (
                <Tooltip key={action.key}>
                  <TooltipTrigger
                    className="flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                    render={
                      <a
                        href={action.href}
                        target={action.key === 'whatsapp' ? '_blank' : undefined}
                        rel={action.key === 'whatsapp' ? 'noreferrer' : undefined}
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
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  )
}
