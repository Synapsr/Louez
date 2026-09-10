import { Section, Text } from "@react-email/components";
import { emailTheme } from "./theme";

/**
 * Free-text note the store owner typed when sending the email by hand from the
 * dashboard. Rendered apart from the template's own copy so the customer reads
 * it as a personal word rather than as part of the automated wording.
 */
export function StoreNote({ message }: { message?: string | null }) {
  if (!message?.trim()) return null;

  return (
    <Section style={noteBox}>
      <Text style={noteText}>{message}</Text>
    </Section>
  );
}

const noteBox = {
  borderLeft: `2px solid ${emailTheme.colors.border}`,
  padding: "4px 0 4px 16px",
  margin: "24px 0",
};

const noteText = {
  fontSize: "15px",
  lineHeight: "24px",
  color: emailTheme.colors.body,
  margin: "0",
  whiteSpace: "pre-line" as const,
};
