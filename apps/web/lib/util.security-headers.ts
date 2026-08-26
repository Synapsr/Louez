export interface SecurityHeadersOptions {
  appDomain?: string;
  fromHelloApiUrl?: string;
  isDevelopment: boolean;
  openReplayIngestPoint?: string;
}

export interface SecurityHeader {
  key: string;
  value: string;
}

const getOrigin = (value?: string): string | null => {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
};

const getStorefrontWildcard = (appDomain?: string): string | null => {
  const baseDomain = (appDomain ?? "").split(":")[0];

  if (!baseDomain || ["localhost", "127.0.0.1"].includes(baseDomain)) {
    return null;
  }

  return `https://*.${baseDomain}`;
};

const buildContentSecurityPolicy = ({
  appDomain,
  fromHelloApiUrl,
  isDevelopment,
  openReplayIngestPoint,
}: SecurityHeadersOptions): string => {
  const fromHelloOrigin = getOrigin(fromHelloApiUrl);
  const openReplayOrigin = getOrigin(openReplayIngestPoint);
  const storefrontWildcard = getStorefrontWildcard(appDomain);
  const directives = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "https://js.stripe.com",
      "https://*.js.stripe.com",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
      "https://eu-assets.i.posthog.com",
      "https://gleapjs.com",
      "https://api.gleap.io",
      "https://unpkg.com",
      "'unsafe-inline'",
      "'unsafe-eval'",
      ...(fromHelloOrigin ? [fromHelloOrigin] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://gleapjs.com"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://lh3.googleusercontent.com",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
      "https://*.basemaps.cartocdn.com",
      "https://*.tile.openstreetmap.org",
      "https://gleapjs.com",
      "https://api.gleap.io",
      "https://staticfiles.gleap.io",
      "https://*.stripe.com",
      "https://img.youtube.com",
      "https://i.ytimg.com",
      ...(isDevelopment ? ["https://picsum.photos", "https://fastly.picsum.photos"] : []),
      "https://*.s3.amazonaws.com",
      "https://*.amazonaws.com",
      "https://*.scw.cloud",
      "https://*.cloud.ovh.net",
      "https://*.digitaloceanspaces.com",
      "https://*.r2.cloudflarestorage.com",
      "https://*.backblazeb2.com",
      "https://*.wasabisys.com",
      "https://*.linodeobjects.com",
      ...(fromHelloOrigin ? [fromHelloOrigin] : []),
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://api.stripe.com",
      "https://maps.googleapis.com",
      "https://places.googleapis.com",
      "https://eu.i.posthog.com",
      "https://eu-assets.i.posthog.com",
      "https://api.gleap.io",
      "wss://ws.gleap.io",
      "https://unpkg.com",
      "https://*.basemaps.cartocdn.com",
      "https://*.tile.openstreetmap.org",
      ...(isDevelopment ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []),
      ...(fromHelloOrigin ? [fromHelloOrigin] : []),
      ...(openReplayOrigin ? [openReplayOrigin] : []),
    ],
    "frame-src": [
      "'self'",
      "https://js.stripe.com",
      "https://*.js.stripe.com",
      "https://hooks.stripe.com",
      "https://gleapjs.com",
      "https://messenger-app.gleap.io",
      ...(storefrontWildcard ? [storefrontWildcard] : []),
    ],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'", "https://www.youtube.com", "https://youtube.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
    ...(!isDevelopment ? { "upgrade-insecure-requests": [] } : {}),
  };

  return Object.entries(directives)
    .map(([directive, sources]) =>
      sources.length === 0 ? directive : `${directive} ${sources.join(" ")}`,
    )
    .join("; ");
};

export const buildSecurityHeaders = (options: SecurityHeadersOptions): SecurityHeader[] => [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(options),
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

export const buildEmbedSecurityHeaders = (options: SecurityHeadersOptions): SecurityHeader[] =>
  buildSecurityHeaders(options)
    .filter((header) => header.key !== "X-Frame-Options")
    .map((header) =>
      header.key === "Content-Security-Policy"
        ? {
            ...header,
            value: header.value.replace(/frame-ancestors\s+'self'/, "frame-ancestors *"),
          }
        : header,
    );
