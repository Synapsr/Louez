'use client'

import { useTranslations } from 'next-intl'
import { Check, MessagesSquare, PhoneCall, Sparkles } from 'lucide-react'

import { Badge, Button } from '@louez/ui'

interface FeaturePresentationProps {
  variant: 'advisor' | 'voice'
  /** Extra fact chips (e.g. the voice tariffs), already translated. */
  chips?: string[]
  onActivate: () => void
}

/**
 * What a face of the assistant does, shown INSIDE its card while it is still
 * disabled — the merchant reads the value proposition right where the
 * activation happens, instead of meeting a bare switch.
 */
export const FeaturePresentation = ({
  variant,
  chips = [],
  onActivate,
}: FeaturePresentationProps) => {
  const t = useTranslations(`dashboard.aiAssistant.hero.${variant}`)
  const tHero = useTranslations('dashboard.aiAssistant.hero')
  const Icon = variant === 'voice' ? PhoneCall : MessagesSquare

  return (
    <div className="from-primary/10 via-background to-background relative overflow-hidden rounded-lg border bg-gradient-to-br p-5">
      <div className="bg-primary/10 pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl" />
      <div className="relative space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">{t('title')}</h3>
            <p className="text-primary flex items-center gap-1 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              {tHero('eyebrow')}
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {(['b1', 'b2', 'b3'] as const).map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm">
              <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Badge key={chip} variant="secondary">
                {chip}
              </Badge>
            ))}
          </div>
        )}

        <Button type="button" className="gap-1.5" onClick={onActivate}>
          <Sparkles className="h-4 w-4" />
          {tHero('activate')}
        </Button>
      </div>
    </div>
  )
}
