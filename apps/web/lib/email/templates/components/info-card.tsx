import { Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "./theme";

interface InfoCardItemProps {
  label: string;
  value: ReactNode;
  footnote?: string | null;
}

/** An extra label/value pair inside an {@link InfoCard}. */
export function InfoCardItem({ label, value, footnote }: InfoCardItemProps) {
  return (
    <>
      <Text style={{ ...styles.label, margin: "12px 0 4px 0" }}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {footnote && <Text style={{ ...styles.small, margin: "4px 0 0 0" }}>{footnote}</Text>}
    </>
  );
}

interface InfoCardProps extends InfoCardItemProps {
  children?: ReactNode;
}

/**
 * The email's one key-info block: a neutral card with an uppercase
 * label and a strong value (a date, an amount…), an optional footnote
 * (timezone line) and optional extra {@link InfoCardItem} rows.
 */
export function InfoCard({ label, value, footnote, children }: InfoCardProps) {
  return (
    <Section style={styles.card}>
      <Text style={{ ...styles.label, margin: "0 0 4px 0" }}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {footnote && <Text style={{ ...styles.small, margin: "4px 0 0 0" }}>{footnote}</Text>}
      {children}
    </Section>
  );
}
