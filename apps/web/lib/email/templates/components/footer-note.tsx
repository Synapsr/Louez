import { Text } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "./theme";

/** A single quiet closing line (link validity, secure payment…). */
export function FooterNote({ children }: { children: ReactNode }) {
  return <Text style={footerNote}>{children}</Text>;
}

const footerNote = {
  ...styles.small,
  margin: "24px 0 0 0",
};
