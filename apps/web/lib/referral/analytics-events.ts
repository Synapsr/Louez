export const referralAnalyticsEvents = {
  hubViewed: 'referral_hub_viewed',
  linkCopied: 'referral_link_copied',
  linkCopyFailed: 'referral_link_copy_failed',
  nudgeViewed: 'referral_nudge_viewed',
  nudgeClicked: 'referral_nudge_clicked',
  nudgeDismissed: 'referral_nudge_dismissed',
  inviteLanded: 'referral_invite_landed',
  attributionResolved: 'referral_store_attribution_resolved',
  referredRewardGranted: 'referral_referred_reward_granted',
  qualifyingPaymentEvaluated: 'referral_qualifying_payment_evaluated',
  rewardGranted: 'referral_reward_granted',
  clawbackEvaluated: 'referral_reward_clawback_evaluated',
  rewardClawedBack: 'referral_reward_clawed_back',
} as const;

export type ReferralAnalyticsEvent =
  (typeof referralAnalyticsEvents)[keyof typeof referralAnalyticsEvents];

export const referralAnalyticsBaseProperties = {
  feature: 'referral_program',
  surface: 'app',
} as const;
