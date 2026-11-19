import type { PartnerCommission } from "@louez/api/contracts/partners";
import { formatCurrency } from "@louez/utils";

/** The rule in words: "10 % of the rental" or "€5.00 per booking". */
export function formatPartnerRule(
  rule: Pick<PartnerCommission, "type" | "value">,
  currency: string,
  t: (key: "rule.percent" | "rule.fixed", values: { value: string }) => string,
): string {
  return rule.type === "percent"
    ? t("rule.percent", { value: String(rule.value) })
    : t("rule.fixed", { value: formatCurrency(rule.value, currency) });
}
