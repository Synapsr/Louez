'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Check, MessagesSquare, PhoneCall, Sparkles } from 'lucide-react'

import { Badge, Button } from '@louez/ui'

interface FeaturePresentationProps {
  variant: 'advisor' | 'voice'
  /** Extra fact chips (e.g. the voice tariffs), already translated. */
  chips?: string[]
  onActivate: () => void
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.35, ease: [0.2, 0, 0, 1] as const },
  },
}

/**
 * What a face of the assistant does, shown INSIDE its card while it is still
 * disabled — the merchant reads the value proposition right where the
 * activation happens, instead of meeting a bare switch. Shares the animated
 * AI mesh identity with the hero and the dashboard AI chat.
 */
export const FeaturePresentation = ({
  variant,
  chips = [],
  onActivate,
}: FeaturePresentationProps) => {
  const t = useTranslations(`dashboard.aiAssistant.hero.${variant}`)
  const tHero = useTranslations('dashboard.aiAssistant.hero')
  const reducedMotion = useReducedMotion()
  const Icon = variant === 'voice' ? PhoneCall : MessagesSquare

  return (
    <div className="relative isolate overflow-hidden rounded-xl border bg-card p-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="ai-mesh-orb ai-mesh-orb--1" />
        <div className="ai-mesh-orb ai-mesh-orb--2" />
      </div>

      <motion.div
        className="relative space-y-4"
        initial={reducedMotion ? false : 'hidden'}
        animate="visible"
        variants={containerVariants}
      >
        <motion.div variants={itemVariants} className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-balance font-semibold">{t('title')}</h3>
            <p className="text-primary flex items-center gap-1 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              {tHero('eyebrow')}
            </p>
          </div>
        </motion.div>

        <ul className="space-y-2">
          {(['b1', 'b2', 'b3'] as const).map((key) => (
            <motion.li
              key={key}
              variants={itemVariants}
              className="flex items-start gap-2 text-sm"
            >
              <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-pretty">{t(key)}</span>
            </motion.li>
          ))}
        </ul>

        {chips.length > 0 && (
          <motion.div variants={itemVariants} className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Badge key={chip} variant="secondary" className="tabular-nums">
                {chip}
              </Badge>
            ))}
          </motion.div>
        )}

        <motion.div variants={itemVariants}>
          <Button
            type="button"
            className="gap-1.5 transition-transform duration-150 ease-out active:scale-[0.96]"
            onClick={onActivate}
          >
            <Sparkles className="h-4 w-4" />
            {tHero('activate')}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  )
}
