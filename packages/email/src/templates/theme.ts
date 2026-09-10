import type { CSSProperties } from "react";

/**
 * Design tokens shared by every email Louez sends, whether the sender is a
 * store (BaseLayout in the app) or the platform itself (BaseLayoutSimple).
 * Neutral by design: a store's primary color only ever reaches the CTA button
 * and links, so any palette sits well on the same quiet shell.
 */
export const DEFAULT_PRIMARY_COLOR = "#0066FF";
export const LOUEZ_BRAND_COLOR = "#1f54dd";

export const emailTheme = {
  colors: {
    ink: "#18181b",
    body: "#3f3f46",
    muted: "#71717a",
    faint: "#a1a1aa",
    border: "#e4e4e7",
    bgSubtle: "#f4f4f5",
    bgPage: "#f4f4f5",
    card: "#ffffff",
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  radius: {
    card: "12px",
    block: "10px",
    button: "8px",
  },
} as const;

const { colors } = emailTheme;

/** Content primitives: the title, paragraphs, labels and blocks inside the card. */
export const styles = {
  title: {
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: "600",
    letterSpacing: "-0.01em",
    color: colors.ink,
    margin: "0 0 20px 0",
  },
  paragraph: {
    fontSize: "15px",
    lineHeight: "24px",
    color: colors.body,
    margin: "0 0 16px 0",
  },
  small: {
    fontSize: "13px",
    lineHeight: "20px",
    color: colors.muted,
    margin: "0 0 8px 0",
  },
  label: {
    fontSize: "11px",
    lineHeight: "16px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: colors.muted,
    margin: "0 0 4px 0",
  },
  value: {
    fontSize: "15px",
    lineHeight: "22px",
    fontWeight: "600",
    color: colors.ink,
    margin: "0",
  },
  amount: {
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: "700",
    letterSpacing: "-0.01em",
    color: colors.ink,
    margin: "0",
  },
  card: {
    backgroundColor: colors.bgSubtle,
    borderRadius: emailTheme.radius.block,
    padding: "18px 20px",
    margin: "24px 0",
  },
  hr: {
    borderColor: colors.border,
    borderWidth: "1px 0 0 0",
    margin: "16px 0",
  },
  detailLabel: {
    fontSize: "14px",
    lineHeight: "22px",
    color: colors.body,
    margin: "0",
  },
  /** A one-time code: big tabular digits on a soft block, no monospace. */
  code: {
    display: "inline-block",
    fontSize: "32px",
    lineHeight: "40px",
    fontWeight: "700",
    letterSpacing: "0.25em",
    fontVariantNumeric: "tabular-nums",
    color: colors.ink,
    backgroundColor: colors.bgSubtle,
    borderRadius: emailTheme.radius.block,
    padding: "14px 20px 14px 28px",
    margin: "0",
  },
  /** The CTA button minus its colours: spread it, then set backgroundColor and color. */
  button: {
    display: "inline-block",
    borderRadius: emailTheme.radius.button,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "600",
    textDecoration: "none",
    textAlign: "center",
    padding: "12px 20px",
  },
  ctaSection: {
    margin: "28px 0",
  },
} satisfies Record<string, CSSProperties>;

/**
 * The shell: a letter on a white page. Logo centred with air, a narrow column
 * whose content stays left-aligned, and the footer on a light grey band that
 * runs edge to edge, so it reads apart from the message without a border.
 */
export const shell = {
  body: {
    backgroundColor: colors.card,
    fontFamily: emailTheme.fontFamily,
    margin: "0",
    padding: "0",
  },
  page: {
    padding: "40px 16px 0",
  },
  container: {
    margin: "0 auto",
    maxWidth: "480px",
  },
  header: {
    padding: "8px 0 36px",
    textAlign: "center",
  },
  logo: {
    display: "block",
    margin: "0 auto",
    maxHeight: "32px",
    maxWidth: "160px",
    objectFit: "contain",
  },
  wordmark: {
    fontSize: "18px",
    lineHeight: "32px",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    color: colors.ink,
    margin: "0",
    textAlign: "center",
  },
  content: {
    padding: "0 0 48px",
  },
  footerBand: {
    backgroundColor: colors.bgSubtle,
    padding: "28px 16px 32px",
  },
  footerText: {
    fontSize: "12px",
    lineHeight: "18px",
    color: colors.faint,
    margin: "0 0 4px 0",
    textAlign: "center",
  },
  footerStrong: {
    fontSize: "12px",
    lineHeight: "18px",
    fontWeight: "600",
    color: colors.muted,
    margin: "0 0 4px 0",
    textAlign: "center",
  },
  footerLink: {
    color: colors.muted,
    textDecoration: "none",
  },
} satisfies Record<string, CSSProperties>;
