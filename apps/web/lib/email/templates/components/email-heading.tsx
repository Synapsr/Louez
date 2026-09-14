import { Heading } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "./theme";

/** The single title of an email — one per message, right under the header. */
export function EmailHeading({ children }: { children: ReactNode }) {
  return <Heading style={styles.title}>{children}</Heading>;
}
