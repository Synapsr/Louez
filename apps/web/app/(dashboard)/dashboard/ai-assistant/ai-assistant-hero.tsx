'use client'

import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
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

// Staggered entrance: each semantic chunk fades up with a light blur, 100ms
// apart — one orchestrated page-load moment instead of scattered effects.
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.4, ease: [0.2, 0, 0, 1] as const },
  },
}

/**
 * Marketing state shown while neither the web advisor nor the voice agent is
 * enabled: sell what the assistant does before showing any setting. The
 * animated gradient mesh reuses the dashboard AI chat's visual identity, so
 * "AI" looks the same everywhere in the product.
 */
export const AiAssistantHero = ({
  hasAdvisorAccess,
  hasVoiceAccess,
}: AiAssistantHeroProps) => {
  const t = useTranslations('dashboard.aiAssistant.hero')
  const router = useRouter()
  const reducedMotion = useReducedMotion()
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
    <div className="relative isolate overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
      {/* Animated gradient mesh — the product's shared "AI" atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="ai-mesh-orb ai-mesh-orb--1" />
        <div className="ai-mesh-orb ai-mesh-orb--2" />
        <div className="ai-mesh-orb ai-mesh-orb--3" />
      </div>

      <motion.div
        className="relative space-y-6"
        initial={reducedMotion ? false : 'hidden'}
        animate="visible"
        variants={containerVariants}
      >
        <div className="max-w-2xl space-y-2">
          <motion.div
            variants={itemVariants}
            className="text-primary flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('eyebrow')}
          </motion.div>
          <motion.h2
            variants={itemVariants}
            className="text-balance text-2xl font-bold leading-tight sm:text-3xl"
          >
            {t('title')}
          </motion.h2>
          <motion.p
            variants={itemVariants}
            className="text-muted-foreground text-pretty text-sm sm:text-base"
          >
            {t('subtitle')}
          </motion.p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => (
            <motion.div
              key={feature.id}
              variants={itemVariants}
              className="group bg-background/70 flex flex-col gap-4 rounded-xl border p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md transition-[translate,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
            >
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-out group-hover:scale-105">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
              </div>
              <ul className="space-y-2">
                {feature.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-pretty">{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {feature.hasAccess ? (
                  <Button
                    variant="outline"
                    className="gap-1.5 transition-transform duration-150 ease-out active:scale-[0.96]"
                    onClick={() => scrollTo(feature.id)}
                  >
                    {t('activate')}
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                  </Button>
                ) : (
                  <Button
                    className="gap-1.5 transition-transform duration-150 ease-out active:scale-[0.96]"
                    onClick={() => router.push('/dashboard/subscription')}
                  >
                    <Zap className="h-4 w-4" />
                    {t('upgrade')}
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {!hasAnyAccess && (
          <motion.p
            variants={itemVariants}
            className="text-muted-foreground text-xs"
          >
            {t('upgradeHint')}
          </motion.p>
        )}
      </motion.div>
    </div>
  )
}
