const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const HOSTNAME_PATTERN = /^(?:localhost|(?:[a-z\d-]+\.)+[a-z]{2,})$/i;
const WHITESPACE_PATTERN = /\s/;

/**
 * Turns what someone typed into a link the storefront can render: a bare
 * `exemple.fr/page` gets `https://`, surrounding whitespace goes, and the
 * result must parse as an `http(s)` URL with a real hostname. Returns
 * null for anything else (`javascript:`, `mailto:`, a lone word), which is
 * also what the storefront sanitiser refuses, so the editor never shows a
 * link the site would strip.
 */
export const normalizeLinkHref = (input: string): string | null => {
  const value = input.trim();

  if (!value || WHITESPACE_PATTERN.test(value)) {
    return null;
  }

  const withScheme = SCHEME_PATTERN.test(value) ? value : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (!HOSTNAME_PATTERN.test(url.hostname)) {
    return null;
  }

  return url.href;
};

/**
 * True when a pasted or typed chunk of text is one address and nothing
 * else, so the editor can turn it straight into a link.
 */
export const isSingleLinkText = (text: string): boolean => normalizeLinkHref(text) !== null;
