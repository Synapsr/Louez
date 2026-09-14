import { Text } from "@react-email/components";
import { emailTheme } from "./theme";

/** Closing lines — supports the multi-line signatures stores configure. */
export function Signature({ text }: { text: string }) {
  return <Text style={signature}>{text}</Text>;
}

const signature = {
  fontSize: "14px",
  lineHeight: "22px",
  color: emailTheme.colors.body,
  margin: "32px 0 0 0",
  whiteSpace: "pre-line" as const,
};
