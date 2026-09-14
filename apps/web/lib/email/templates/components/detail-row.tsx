import { Column, Row, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "./theme";

interface DetailRowProps {
  label: ReactNode;
  value?: ReactNode;
  /** `amount` renders the value large, for the one total of a card. */
  emphasis?: "value" | "amount";
}

/** One label/value line inside a card: label left in body grey, value right in ink. */
export function DetailRow({ label, value, emphasis = "value" }: DetailRowProps) {
  return (
    <Row style={row}>
      <Column>
        <Text style={styles.detailLabel}>{label}</Text>
      </Column>
      {value !== undefined && value !== null && (
        <Column align="right">
          <Text style={emphasis === "amount" ? styles.amount : styles.value}>{value}</Text>
        </Column>
      )}
    </Row>
  );
}

const row = {
  marginBottom: "4px",
};
