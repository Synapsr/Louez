import posthog from "posthog-js";

import type { PublicEnv } from "@/lib/validators/validator.public-env";

const POSTHOG_DISTINCT_ID_FRAGMENT = "ph_distinct_id";
const POSTHOG_SESSION_ID_FRAGMENT = "ph_session_id";
const MAX_POSTHOG_ID_LENGTH = 200;

type AcquisitionBootstrap = {
  distinctID: string;
  isIdentifiedID: false;
  sessionID?: string;
};

let initializedProjectKey: string | undefined;

const isValidPostHogId = (value: string | null): value is string =>
  Boolean(
    value &&
    value.length <= MAX_POSTHOG_ID_LENGTH &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    }),
  );

const hasPersistedPostHogIdentity = (projectKey: string): boolean => {
  const persistenceName = `ph_${projectKey}_posthog`;

  try {
    if (window.localStorage.getItem(persistenceName)) {
      return true;
    }
  } catch {
    // localStorage can be unavailable in strict privacy modes.
  }

  return document.cookie.split("; ").some((cookie) => cookie.startsWith(`${persistenceName}=`));
};

const readAcquisitionBootstrap = ({
  isDashboard,
  projectKey,
}: {
  isDashboard: boolean;
  projectKey: string;
}): AcquisitionBootstrap | undefined => {
  if (!isDashboard || hasPersistedPostHogIdentity(projectKey)) {
    return undefined;
  }

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const distinctID = fragment.get(POSTHOG_DISTINCT_ID_FRAGMENT);
  const sessionID = fragment.get(POSTHOG_SESSION_ID_FRAGMENT);

  if (!isValidPostHogId(distinctID)) {
    return undefined;
  }

  return {
    distinctID,
    isIdentifiedID: false,
    ...(isValidPostHogId(sessionID) ? { sessionID } : {}),
  };
};

const removeAcquisitionFragment = () => {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));

  if (!fragment.has(POSTHOG_DISTINCT_ID_FRAGMENT) && !fragment.has(POSTHOG_SESSION_ID_FRAGMENT)) {
    return;
  }

  fragment.delete(POSTHOG_DISTINCT_ID_FRAGMENT);
  fragment.delete(POSTHOG_SESSION_ID_FRAGMENT);
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

const resolveSurface = (appDomain: string): { isDashboard: boolean; storeSlug: string | null } => {
  const hostname = window.location.hostname.toLowerCase();
  const baseDomain = appDomain.split(":")[0].toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return { isDashboard: true, storeSlug: null };
  }

  if (hostname === `app.${baseDomain}`) {
    return { isDashboard: true, storeSlug: null };
  }

  if (hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.slice(0, -(baseDomain.length + 1));
    if (subdomain && subdomain !== "www") {
      return { isDashboard: false, storeSlug: subdomain };
    }
  }

  return { isDashboard: false, storeSlug: null };
};

export const initializePostHog = (config: PublicEnv): void => {
  const projectKey = config.NEXT_PUBLIC_POSTHOG_KEY;

  if (!projectKey || initializedProjectKey === projectKey) {
    return;
  }

  const { isDashboard, storeSlug } = resolveSurface(config.NEXT_PUBLIC_APP_DOMAIN);
  const acquisitionBootstrap = readAcquisitionBootstrap({
    isDashboard,
    projectKey,
  });

  posthog.init(projectKey, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2025-11-30",
    loaded: (posthogClient) => {
      if (process.env.NODE_ENV === "development") {
        posthogClient.opt_out_capturing();
      }
    },
    respect_dnt: true,
    capture_pageview: false,
    capture_pageleave: true,
    ...(acquisitionBootstrap ? { bootstrap: acquisitionBootstrap } : {}),
    ...(isDashboard
      ? {
          cross_subdomain_cookie: false,
        }
      : {
          persistence: "memory",
          person_profiles: "identified_only",
          autocapture: false,
          disable_session_recording: true,
          capture_heatmaps: false,
          capture_dead_clicks: false,
          disable_surveys: true,
        }),
  });

  posthog.register({
    surface: isDashboard ? "dashboard" : storeSlug ? "storefront" : "marketing",
    ...(storeSlug ? { store_slug: storeSlug } : {}),
    ...(config.NEXT_PUBLIC_APP_VERSION ? { $app_version: config.NEXT_PUBLIC_APP_VERSION } : {}),
  });

  initializedProjectKey = projectKey;
  removeAcquisitionFragment();
};
