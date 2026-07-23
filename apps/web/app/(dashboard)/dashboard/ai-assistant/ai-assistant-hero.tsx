'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  Check,
  MessagesSquare,
  PhoneCall,
  Sparkles,
  Zap,
} from 'lucide-react'

import { Button } from '@louez/ui'

interface AiAssistantHeroProps {
  /** Whether the plan includes each side (drives Activate vs Upgrade CTAs). */
  hasAdvisorAccess: boolean
  hasVoiceAccess: boolean
}

const scrollTo = (id: string) => {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Marketing state shown while neither the web advisor nor the voice agent is
 * enabled: sell what the assistant does before showing any setting. Each side
 * gets its own card with concrete benefits and a direct "activate" path that
 * scrolls to the matching section below.
 */
export const AiAssistantHero = ({
  hasAdvisorAccess,
  hasVoiceAccess,
}: AiAssistantHeroProps) => {
  const t = useTranslations('dashboard.aiAssistant.hero')
  const router = useRouter()
  const hasAnyAccess = hasAdvisorAccess || hasVoiceAccess

  const features: {
    id: string
    icon: typeof MessagesSquare
    title: string
    bullets: string[]
    hasAccess: boolean
  }[] = [
    {
      id: 'advisor-section',
      icon: MessagesSquare,
      title: t('advisor.title'),
      bullets: [t('advisor.b1'), t('advisor.b2'), t('advisor.b3')],
      hasAccess: hasAdvisorAccess,
    },
    {
      id: 'voice-section',
      icon: PhoneCall,
      title: t('voice.title'),
      bullets: [t('voice.b1'), t('voice.b2'), t('voice.b3')],
      hasAccess: hasVoiceAccess,
    },
  ]

  return (
    <div className="from-primary/10 via-background to-background relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 sm:p-8">
      <div className="bg-primary/10 pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl" />

      <div className="relative space-y-6">
        <div className="max-w-2xl space-y-2">
          <div className="text-primary flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="h-3.5 w-3.5" />
            {t('eyebrow')}
          </div>
          <h2 className="text-2xl font-bold leading-tight sm:text-3xl">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="bg-background/80 flex flex-col gap-4 rounded-lg border p-5 backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
              </div>
              <ul className="space-y-2">
                {feature.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {feature.hasAccess ? (
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => scrollTo(feature.id)}
                  >
                    {t('activate')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    className="gap-1.5"
                    onClick={() => router.push('/dashboard/subscription')}
                  >
                    <Zap className="h-4 w-4" />
                    {t('upgrade')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!hasAnyAccess && (
          <p className="text-muted-foreground text-xs">{t('upgradeHint')}</p>
        )}
      </div>
    </div>
  )
}
