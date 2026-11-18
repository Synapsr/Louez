/**
 * The rules of the Google Ads "account created" conversion (docs/analytics/lifecycle.md):
 * which sign-up owes one, when it may be uploaded, and when it no longer can. Pure; the
 * queue and the upload are in google-ads-conversion-record.ts.
 */

import type { FirstTouch } from "@/lib/acquisition/first-touch";

export type ClickIdType = "gclid" | "gbraid" | "wbraid";
export type AdConsent = "granted" | "denied";

/**
 * Google refuses a click conversion uploaded less than 6 hours after its click
 * (Google Ads' TOO_RECENT_EVENT): the upload waits that long, and a margin.
 */
export const MIN_CLICK_AGE_MS = 6 * 3_600_000;
export const UPLOAD_MARGIN_MS = 15 * 60_000;
/**
 * The longest a click can be attributed: Google keeps a click 90 days, and a conversion
 * action's click-through window is 90 days at most. Past it the row expires unsent. The
 * site's cookie also lives 90 days, so the cookie's `ts`, never its presence, decides.
 */
export const MAX_CLICK_AGE_MS = 90 * 86_400_000;
/** Runs of one conversion before it is abandoned. */
export const MAX_UPLOAD_ATTEMPTS = 8;

/**
 * The person's consent to Google's ad_user_data and ad_personalization, as known at
 * sign-up. Neither louez.io nor app.louez.io has a consent mechanism, so nothing grants
 * it: both are `denied`, never assumed granted. Google discards an EEA user's
 * conversion without both granted (docs/analytics/lifecycle.md). When a consent banner
 * exists, read its answer here, on the sign-up's request.
 */
export const AD_CONSENT_AT_SIGN_UP = {
  adUserData: "denied",
  adPersonalization: "denied",
} as const satisfies Record<string, AdConsent>;

export interface PendingGoogleAdsConversion {
  userId: string;
  clickIdType: ClickIdType;
  clickId: string;
  clickedAt: Date;
  convertedAt: Date;
  adUserDataConsent: AdConsent;
  adPersonalizationConsent: AdConsent;
  /** The first upload: once the click is old enough. */
  nextAttemptAt: Date;
}

/**
 * The touch's ad click id: the gclid, else the gbraid, else the wbraid. Google takes
 * one of them per conversion.
 */
export function adClickOf(touch: FirstTouch | null): { type: ClickIdType; id: string } | null {
  if (touch?.gclid) return { type: "gclid", id: touch.gclid };
  if (touch?.gbraid) return { type: "gbraid", id: touch.gbraid };
  if (touch?.wbraid) return { type: "wbraid", id: touch.wbraid };
  return null;
}

/** When a conversion whose click was at `clickedAt` can no longer be uploaded. */
export const conversionExpiresAt = (clickedAt: Date) =>
  new Date(clickedAt.getTime() + MAX_CLICK_AGE_MS);

/**
 * The conversion a new account owes Google Ads, or null: no ad click id in the touch,
 * no click time (its age cannot be told), or a click already past the 90 days. A click
 * dated after the account (a clock ahead on the site) counts as made with it: Google
 * wants the conversion after its click.
 */
export function pendingGoogleAdsConversion(input: {
  userId: string;
  touch: FirstTouch | null;
  convertedAt: Date;
  consent?: { adUserData: AdConsent; adPersonalization: AdConsent };
}): PendingGoogleAdsConversion | null {
  const click = adClickOf(input.touch);
  if (!click || !input.touch?.ts) return null;
  const touchedAt = Date.parse(input.touch.ts);
  if (!Number.isFinite(touchedAt)) return null;
  const clickedAt = new Date(Math.min(touchedAt, input.convertedAt.getTime()));
  if (input.convertedAt.getTime() >= conversionExpiresAt(clickedAt).getTime()) return null;
  const consent = input.consent ?? AD_CONSENT_AT_SIGN_UP;
  return {
    userId: input.userId,
    clickIdType: click.type,
    clickId: click.id,
    clickedAt,
    convertedAt: input.convertedAt,
    adUserDataConsent: consent.adUserData,
    adPersonalizationConsent: consent.adPersonalization,
    nextAttemptAt: new Date(
      Math.max(clickedAt.getTime() + MIN_CLICK_AGE_MS, input.convertedAt.getTime()) +
        UPLOAD_MARGIN_MS,
    ),
  };
}

/** The wait before the next run of a failed upload: 15 min, 30 min, 1 h… at most 24 h. */
export function uploadRetryDelayMs(attempts: number) {
  return Math.min(15 * 60_000 * 2 ** Math.max(0, attempts - 1), 24 * 3_600_000);
}
