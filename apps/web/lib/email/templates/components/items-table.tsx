import { Column, Hr, Row, Section, Text } from "@react-email/components";
import { emailTheme, styles } from "./theme";

interface ItemsTableProps {
  items: { name: string; quantity: number; totalPrice: number }[];
  /** Subtotal / tax / deposit / total… expressed uniformly as rows. */
  totals: { label: string; amount: number; bold?: boolean }[];
  formatCurrency: (amount: number) => string;
}

/** The reserved products and their totals, as a quiet two-column list. */
export function ItemsTable({ items, totals, formatCurrency }: ItemsTableProps) {
  return (
    <Section style={{ margin: "24px 0" }}>
      {items.map((item, index) => (
        <Row key={index} style={itemRow}>
          <Column>
            <Text style={itemName}>
              {item.name}
              {item.quantity > 1 ? ` × ${item.quantity}` : ""}
            </Text>
          </Column>
          <Column align="right">
            <Text style={itemPrice}>{formatCurrency(item.totalPrice)}</Text>
          </Column>
        </Row>
      ))}

      <Hr style={styles.hr} />

      {totals.map((total, index) => (
        <Row key={index} style={itemRow}>
          <Column>
            <Text style={total.bold ? totalLabelBold : itemName}>{total.label}</Text>
          </Column>
          <Column align="right">
            <Text style={total.bold ? totalAmountBold : itemPrice}>
              {formatCurrency(total.amount)}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

const itemRow = {
  marginBottom: "6px",
};

const itemName = {
  fontSize: "14px",
  lineHeight: "20px",
  color: emailTheme.colors.body,
  margin: "0",
};

const itemPrice = {
  fontSize: "14px",
  lineHeight: "20px",
  color: emailTheme.colors.ink,
  fontVariantNumeric: "tabular-nums" as const,
  margin: "0",
};

const totalLabelBold = {
  fontSize: "15px",
  lineHeight: "24px",
  fontWeight: "600" as const,
  color: emailTheme.colors.ink,
  margin: "0",
};

const totalAmountBold = {
  fontSize: "17px",
  lineHeight: "24px",
  fontWeight: "700" as const,
  letterSpacing: "-0.01em",
  color: emailTheme.colors.ink,
  fontVariantNumeric: "tabular-nums" as const,
  margin: "0",
};
