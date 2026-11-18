"use client";

import { useTranslations } from "next-intl";

import type { AiVisibilityView } from "@louez/api/contracts/ai-visibility";

import { AI_ASSISTANT_NAMES, toAiAssistantRows } from "./util.ai-assistant-rows";

/** Visits and crawler reads per assistant, the most active first. */
export const AiAssistantTable = ({ view }: { view: AiVisibilityView }) => {
  const t = useTranslations("dashboard.visibility.ai");
  const rows = toAiAssistantRows(view);

  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <table className="w-full">
      <thead className="text-muted-foreground text-left text-xs">
        <tr>
          <th className="pb-1 font-normal">{t("table.assistant")}</th>
          <th className="pb-1 text-right font-normal">{t("table.visits")}</th>
          <th className="pb-1 text-right font-normal">{t("table.reads")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.assistant} className="border-t">
            <td className="py-1.5">
              {row.assistant === "other"
                ? t("assistants.other")
                : AI_ASSISTANT_NAMES[row.assistant]}
            </td>
            <td className="py-1.5 text-right tabular-nums">{row.visits}</td>
            <td className="py-1.5 text-right tabular-nums">{row.hits}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
