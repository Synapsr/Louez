import { useFormatter, useTranslations } from "next-intl";

import type { ShownDetail, ShownValue } from "@louez/api/services/approval-page";

interface ApprovalDetailsProps {
  entries: ShownDetail[];
  /** The time zone the store's dates are written in. */
  timeZone: string;
}

/**
 * What Louez checked, for a phone first: a flat list, each entry a label and
 * its value, on one line when both are short and the value under its label
 * otherwise, full width, never in a column of its own. A nested group is a
 * titled block of such lines, set in by a rule on one side, never a table in
 * a table. Values read as a person writes them, in the page's locale: dates
 * in the store's time zone, amounts in their currency, numbers and yes or
 * no; an empty list "None". Each label, heading and value is its own
 * isolated run of text (`bdi`) in a box that clips what it draws past its
 * line, so none of them covers anything around it;
 * a long word breaks only when nothing else can.
 */
export const ApprovalDetails = ({ entries, timeZone }: ApprovalDetailsProps) => {
  const t = useTranslations("handoff.operation_approval.values");
  const format = useFormatter();

  // An empty list ("no message") is a fact, written as such.
  const written = (value: Exclude<ShownValue, { kind: "group" }>): string => {
    switch (value.kind) {
      case "text":
        return value.text;
      case "number":
        return format.number(value.value);
      case "money":
        return format.number(value.amount, { style: "currency", currency: value.currency });
      case "date":
        return value.dateOnly
          ? format.dateTime(new Date(value.iso), { dateStyle: "medium", timeZone: "UTC" })
          : format.dateTime(new Date(value.iso), { dateStyle: "medium", timeStyle: "short", timeZone });
      case "yes":
      case "no":
        return t(value.kind);
    }
  };

  return (
    <dl className="space-y-2.5 text-sm">
      {entries.map(({ label, value }, index) =>
        value.kind === "group" && value.entries.length > 0 ? (
          <div key={`${index}-${label}`} className="space-y-2">
            {label && (
              <dt className="text-foreground overflow-hidden font-medium wrap-break-word">
                <bdi>{label}</bdi>
              </dt>
            )}
            <dd className="border-border min-w-0 border-l-2 pl-3">
              <ApprovalDetails entries={value.entries} timeZone={timeZone} />
            </dd>
          </div>
        ) : (
          <div
            key={`${index}-${label}`}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
          >
            {label && (
              <dt className="text-muted-foreground min-w-0 overflow-hidden wrap-break-word">
                <bdi>{label}</bdi>
              </dt>
            )}
            <dd className="text-foreground min-w-0 max-w-full overflow-hidden font-medium wrap-break-word">
              <bdi>{value.kind === "group" ? t("none") : written(value)}</bdi>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
};
