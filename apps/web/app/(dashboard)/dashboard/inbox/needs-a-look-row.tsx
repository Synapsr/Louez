"use client";

import { useState } from "react";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { TriangleAlertIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import type { NeedsALookItem } from "@/lib/inbox/needs-a-look";
import type { NeedsALookDisplay } from "@/lib/inbox/needs-a-look-display";

import { NeedsALookDetails } from "./needs-a-look-details";

interface NeedsALookRowProps {
  item: NeedsALookItem;
  display: NeedsALookDisplay;
  canAcknowledge: boolean;
  pending: boolean;
  onAcknowledge: () => Promise<unknown>;
}

/**
 * One item: its mark, title and one line, opening where it is fixed (the
 * reservation's payment for money); the details and "Mark as handled" stay
 * behind the disclosure. An item with nowhere to open toggles its details.
 */
export const NeedsALookRow = ({
  item,
  display,
  canAcknowledge,
  pending,
  onAcknowledge,
}: NeedsALookRowProps) => {
  const t = useTranslations("dashboard.needsALook");
  const [open, setOpen] = useState(false);
  const detailsId = `needs-a-look-${item.id}`;

  const title = (
    <>
      <span className="min-w-0 truncate font-medium">{t(display.title.key)}</span>
      {item.severity === "critical" && (
        <Badge variant="failed" size="sm" className="shrink-0">
          {t("urgent")}
        </Badge>
      )}
    </>
  );
  const subtitle = <span className="min-w-0 truncate">{display.line.join(" · ")}</span>;
  const leading = (
    <DashboardIconTile
      icon={TriangleAlertIcon}
      size="sm"
      accent={item.severity === "info" ? "neutral" : "pending"}
    />
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {display.action ? (
        <DashboardListRow
          href={display.action.href}
          leading={leading}
          title={title}
          subtitle={subtitle}
          meta={<span className="text-primary hidden sm:inline">{t(display.action.label)}</span>}
        />
      ) : (
        <DashboardListRow
          href=""
          onSelect={() => setOpen((current) => !current)}
          leading={leading}
          title={title}
          subtitle={subtitle}
        />
      )}
      <CollapsibleTrigger
        aria-controls={detailsId}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ms-13 flex min-h-8 items-center gap-1 rounded-md px-1 text-sm focus-visible:ring-2 focus-visible:outline-none sm:ms-14"
      >
        {t("details")}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel id={detailsId}>
        <NeedsALookDetails
          display={display}
          canAcknowledge={canAcknowledge}
          pending={pending}
          onAcknowledge={onAcknowledge}
        />
      </CollapsiblePanel>
    </Collapsible>
  );
};
