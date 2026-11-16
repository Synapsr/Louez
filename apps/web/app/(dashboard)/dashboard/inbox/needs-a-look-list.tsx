"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardPanel } from "@louez/ui";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import type { NeedsALookItem } from "@/lib/inbox/needs-a-look";
import { describeNeedsALookItem } from "@/lib/inbox/needs-a-look-display";

import { NeedsALookRow } from "./needs-a-look-row";
import { useNeedsALook } from "./use-needs-a-look";

interface NeedsALookListProps {
  items: NeedsALookItem[];
  /** Some kinds could not be read: the list may be incomplete. */
  incomplete: boolean;
  /** The member may mark items handled (write access). */
  canAcknowledge: boolean;
}

/** The items that need a look, oldest first, or the empty state. */
export const NeedsALookList = ({ items, incomplete, canAcknowledge }: NeedsALookListProps) => {
  const t = useTranslations("dashboard.needsALook");
  const { format, visible, acknowledge, pendingId } = useNeedsALook(items);

  return (
    <div className="space-y-3">
      {incomplete && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("incomplete")}
        </p>
      )}
      <Card>
        <CardPanel className="p-2 sm:p-3">
          {visible.length === 0 ? (
            <DashboardEmptyState
              icon={CircleCheck}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          ) : (
            <ul className="divide-border divide-y">
              {visible.map((item) => (
                <li key={item.id} className="py-1 first:pt-0 last:pb-0">
                  <NeedsALookRow
                    item={item}
                    display={describeNeedsALookItem(item, format)}
                    canAcknowledge={canAcknowledge}
                    pending={pendingId === item.id}
                    onAcknowledge={() => acknowledge(item)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardPanel>
      </Card>
    </div>
  );
};
