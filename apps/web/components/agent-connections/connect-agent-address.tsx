"use client";

import { useTranslations } from "next-intl";

import { CopyButton } from "@/components/ui/copy-button";

/** The connection address under its plain name, with a button to copy it. */
export const ConnectAgentAddress = ({ mcpUrl }: { mcpUrl: string }) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{t("addressLabel")}</p>
      <div className="flex items-center gap-2 rounded-lg border p-1 ps-3">
        <code className="min-w-0 flex-1 truncate text-sm">{mcpUrl}</code>
        <CopyButton
          value={mcpUrl}
          label={t("copy")}
          copiedLabel={t("copied")}
          variant="ghost"
          size="sm"
          className="shrink-0"
        />
      </div>
    </div>
  );
};
