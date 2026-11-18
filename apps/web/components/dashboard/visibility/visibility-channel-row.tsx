import type { ComponentType } from "react";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";

/** A channel the guide points to without a step of its own (reeent, the website widget). */
export const VisibilityChannelRow = ({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) => (
  <DashboardListRow
    href={href}
    leading={<DashboardIconTile icon={icon} accent="neutral" />}
    title={<span className="truncate font-medium">{title}</span>}
    subtitle={<span className="truncate">{description}</span>}
  />
);
