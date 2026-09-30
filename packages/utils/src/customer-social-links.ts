import {
  CUSTOMER_SOCIAL_NETWORKS,
  type CustomerSocialLinks,
  type CustomerSocialNetwork,
} from "@louez/types";

/** Hosts a pasted profile URL may come from, per network. */
const NETWORK_HOSTS: Record<Exclude<CustomerSocialNetwork, "website" | "whatsapp">, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  facebook: ["facebook.com", "fb.com", "m.facebook.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com"],
  linkedin: ["linkedin.com"],
  x: ["x.com", "twitter.com"],
};

/** Path prefixes that precede the handle on a profile URL. */
const PROFILE_PATH_PREFIXES = ["in", "company", "c", "channel", "user"];

const stripHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
};

const looksLikeUrl = (value: string) => value.includes("/") || /\.[a-z]{2,}$/i.test(value);

/**
 * What is stored for a network, from whatever the merchant typed or pasted:
 * a handle without "@" for the social networks, a full URL for a website and
 * digits with a leading "+" for WhatsApp. Returns null for an empty value.
 */
export function normalizeCustomerSocialLink(
  network: CustomerSocialNetwork,
  input: string | null | undefined,
): string | null {
  const value = input?.trim();
  if (!value) return null;

  if (network === "website") {
    return parseUrl(value)?.toString().replace(/\/$/, "") ?? null;
  }

  if (network === "whatsapp") {
    const fromLink = parseUrl(value);
    const raw =
      fromLink && stripHost(fromLink.hostname) === "wa.me" ? fromLink.pathname.slice(1) : value;
    const digits = raw.replace(/[^\d]/g, "");
    return digits ? `+${digits}` : null;
  }

  if (looksLikeUrl(value)) {
    const url = parseUrl(value);
    if (url && NETWORK_HOSTS[network].includes(stripHost(url.hostname))) {
      const segments = url.pathname.split("/").filter(Boolean);
      const handle =
        segments.length > 1 && PROFILE_PATH_PREFIXES.includes(segments[0])
          ? segments[1]
          : segments[0];
      return handle ? handle.replace(/^@/, "") : null;
    }
  }

  return value.replace(/^@/, "").replace(/\s+/g, "") || null;
}

/** The public URL of a stored link. */
export function getCustomerSocialLinkUrl(network: CustomerSocialNetwork, value: string): string {
  switch (network) {
    case "website":
      return value;
    case "whatsapp":
      return `https://wa.me/${value.replace(/[^\d]/g, "")}`;
    case "instagram":
      return `https://instagram.com/${value}`;
    case "facebook":
      return `https://facebook.com/${value}`;
    case "tiktok":
      return `https://tiktok.com/@${value}`;
    case "youtube":
      return `https://youtube.com/@${value}`;
    case "linkedin":
      return `https://linkedin.com/in/${value}`;
    case "x":
      return `https://x.com/${value}`;
  }
}

/** How a stored link reads to a person: "@handle", a bare domain, or the phone number. */
export function formatCustomerSocialLink(network: CustomerSocialNetwork, value: string): string {
  if (network === "website") return value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (network === "whatsapp") return value;
  return `@${value}`;
}

export interface CustomerSocialLinkEntry {
  network: CustomerSocialNetwork;
  value: string;
}

/** The links a customer has, in display order, blank entries dropped. */
export function resolveCustomerSocialLinks(
  links: CustomerSocialLinks | null | undefined,
): CustomerSocialLinkEntry[] {
  return CUSTOMER_SOCIAL_NETWORKS.flatMap((network) => {
    const value = links?.[network]?.trim();
    return value ? [{ network, value }] : [];
  });
}

/** Normalises every entry and drops the empty ones; null when nothing is left. */
export function normalizeCustomerSocialLinks(
  links: CustomerSocialLinks | null | undefined,
): CustomerSocialLinks | null {
  const entries = CUSTOMER_SOCIAL_NETWORKS.flatMap((network) => {
    const value = normalizeCustomerSocialLink(network, links?.[network]);
    return value ? [[network, value] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
