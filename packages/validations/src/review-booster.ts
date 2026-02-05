import { z } from 'zod'
import type { ReviewBoosterSettings } from '@louez/types'

export const reviewBoosterSettingsSchema = z.object({
  enabled: z.boolean(),
  // Google Place info
  googlePlaceId: z.string().max(255).nullable(),
  googlePlaceName: z.string().max(255).nullable(),
  googlePlaceAddress: z.string().max(500).nullable(),
  googleRating: z.number().min(0).max(5).nullable(),
  googleReviewCount: z.number().int().min(0).nullable(),
  // Feature toggles
  displayReviewsOnStorefront: z.boolean(),
  showReviewPromptInPortal: z.boolean(),
  // Automation settings
  autoSendThankYouEmail: z.boolean(),
  autoSendThankYouSms: z.boolean(),
  emailDelayHours: z.number().int().min(1).max(168), // 1 hour to 7 days
  smsDelayHours: z.number().int().min(1).max(168),
})

export type ReviewBoosterSettingsInput = z.infer<typeof reviewBoosterSettingsSchema>

export const googlePlaceSearchSchema = z.object({
  query: z.string().min(2).max(200),
})

export type GooglePlaceSearchInput = z.infer<typeof googlePlaceSearchSchema>

// Default settings when enabling Review Booster
export const defaultReviewBoosterSettings: ReviewBoosterSettings = {
  enabled: false,
  googlePlaceId: null,
  googlePlaceName: null,
  googlePlaceAddress: null,
  googleRating: null,
  googleReviewCount: null,
  displayReviewsOnStorefront: false,
  showReviewPromptInPortal: false,
  autoSendThankYouEmail: false,
  autoSendThankYouSms: false,
  emailDelayHours: 24,
  smsDelayHours: 24,
}
