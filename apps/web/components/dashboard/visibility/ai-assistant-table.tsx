"use client";

import { useTranslations } from "next-intl";

import { AI_ASSISTANT_NAMES, type AiAssistantRow } from "./util.ai-assistant-rows";

/** Visits, reservations when known, and crawler reads per assistant, the most active first. */
export const AiAssistantTable = ({ rows }: { rows: readonly AiAssistantRow[] }) => {
  const t = useTranslations("dashboard.visibility.ai");
  const withBookings = rows.some((row) => row.bookings !== undefined);

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-left text-xs">
        <tr>
          <th className="pb-1 font-normal">{t("table.assistant")}</th>
          <th className="pb-1 text-right font-normal">{t("table.visits")}</th>
          {withBookings && <th className="pb-1 text-right font-normal">{t("table.bookings")}</th>}
          <th className="pb-1 text-right font-normal">{t("table.reads")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.assistant} className="border-t">
            <td className="py-1.5">
              {row.assistant === "other" ? t("assistants.other") : AI_ASSISTANT_NAMES[row.assistant]}
            </td>
            <td className="py-1.5 text-right tabular-nums">{row.visits}</td>
            {withBookings && (
              <td className="py-1.5 text-right tabular-nums">{row.bookings ?? 0}</td>
            )}
            <td className="py-1.5 text-right tabular-nums">{row.hits}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
