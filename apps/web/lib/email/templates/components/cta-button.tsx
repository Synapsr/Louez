import { Button, Section } from "@react-email/components";
import { getContrastColorHex } from "@/lib/utils/colors";
import { DEFAULT_PRIMARY_COLOR, emailTheme } from "./theme";

interface CtaButtonProps {
  href: string;
  label: string;
  primaryColor?: string;
}

/** The email's one call to action — the only place button styling lives. */
export function CtaButton({ href, label, primaryColor = DEFAULT_PRIMARY_COLOR }: CtaButtonProps) {
  return (
    <Section style={ctaSection}>
      <Button
        href={href}
        style={{
          backgroundColor: primaryColor,
          color: getContrastColorHex(primaryColor),
          borderRadius: emailTheme.radius.button,
          fontSize: "14px",
          lineHeight: "20px",
          fontWeight: "600",
          textDecoration: "none",
          textAlign: "center" as const,
          display: "inline-block",
          padding: "12px 20px",
        }}
      >
        {label}
      </Button>
    </Section>
  );
}

const ctaSection = {
  margin: "28px 0",
};
