import { useTranslations } from "next-intl";

import type { ShownDetail } from "@louez/api/services/approval-page";

/**
 * The details of an approval's preview, as text, a nested list in its own
 * list. Each text value is its own isolated run (`bdi`): a name written right
 * to left cannot move the text around it. A level's labels are its keys, or
 * its items' places, so each is unique within it.
 */
export const ApprovalDetails = ({ entries }: { entries: ShownDetail[] }) => {
  const t = useTranslations("handoff.operation_approval.values");
  return (
    <dl className="divide-border divide-y rounded-lg border text-sm">
      {entries.map(({ label, value }) => (
        <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {label && <dt className="text-muted-foreground wrap-anywhere">{label}</dt>}
          <dd className={label ? "min-w-0" : "min-w-0 sm:col-span-2"}>
            {value.kind === "text" ? (
              <bdi className="whitespace-pre-line wrap-anywhere">{value.text}</bdi>
            ) : value.kind === "list" && value.entries.length > 0 ? (
              <ApprovalDetails entries={value.entries} />
            ) : value.kind === "yes" || value.kind === "no" ? (
              <span>{t(value.kind)}</span>
            ) : (
              <span className="text-muted-foreground">{t("none")}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
};
