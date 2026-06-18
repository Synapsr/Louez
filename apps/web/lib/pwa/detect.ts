/**
 * Lightweight platform / browser / in-app-webview detection used to adapt the
 * PWA install prompt to the user's environment.
 *
 * This is intentionally client-side only — installability and "Add to Home
 * Screen" both depend on browser APIs that have no server equivalent.
 */

export type PwaOs = 'ios' | 'android' | 'desktop' | 'other';
export type PwaBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';

export interface PlatformInfo {
  os: PwaOs;
  browser: PwaBrowser;
  /**
   * True when running inside an embedded webview (Instagram, Facebook, TikTok,
   * …) where a PWA can never be installed. We surface "open in your browser"
   * guidance instead of an install affordance in these cases.
   */
  isInAppBrowser: boolean;
}

// Webviews of social / messaging apps. `; wv)` is the generic Android WebView
// marker; the named tokens cover the most common in-app browsers.
const IN_APP_BROWSER_PATTERN =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat|Pinterest|LinkedInApp|MicroMessenger|; wv\)|GSA\//i;

/**
 * iPadOS 13+ reports a desktop Safari user-agent. When the UA still carries the
 * "iPad" token we trust it; otherwise the reliable tell is a "Macintosh"
 * platform that also exposes touch points. The touch signal can only come from
 * a live `navigator`, so a bare UA string alone cannot disambiguate an
 * iPadOS-13+ Safari from real macOS.
 */
function isIPadOS(ua: string): boolean {
  if (/ipad/i.test(ua)) return true;
  if (typeof navigator === 'undefined') return false;
  const looksLikeMac =
    /macintosh|mac os x/i.test(ua) || navigator.platform === 'MacIntel';
  return (
    looksLikeMac &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  );
}

export function detectPlatform(userAgent?: string): PlatformInfo {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '');

  if (!ua) {
    return { os: 'other', browser: 'other', isInAppBrowser: false };
  }

  let os: PwaOs = 'other';
  if (/iphone|ipod/i.test(ua) || isIPadOS(ua)) {
    os = 'ios';
  } else if (/android/i.test(ua)) {
    os = 'android';
  } else if (/windows|macintosh|mac os x|linux|cros/i.test(ua)) {
    os = 'desktop';
  }

  // Order matters: Edge, Firefox and Chrome on iOS all also contain "Safari"
  // (and on iOS additionally "CriOS"/"FxiOS"/"EdgiOS"), so check the more
  // specific tokens first and fall back to Safari last.
  let browser: PwaBrowser = 'other';
  if (/edg(a|ios)?\//i.test(ua)) {
    browser = 'edge';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'firefox';
  } else if (/crios|chrome|chromium/i.test(ua)) {
    browser = 'chrome';
  } else if (/safari/i.test(ua)) {
    browser = 'safari';
  }

  return {
    os,
    browser,
    isInAppBrowser: IN_APP_BROWSER_PATTERN.test(ua),
  };
}
