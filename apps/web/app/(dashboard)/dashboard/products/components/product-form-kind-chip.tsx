"use client";

import type { ComponentType } from "react";

interface ProductFormKindChipProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
}

/** A pricing kind or stock option named with the icon of its choice card. */
export const ProductFormKindChip = ({ icon: Icon, label }: ProductFormKindChipProps) => (
  <span className="bg-background inline-flex items-center gap-1.5 justify-self-start rounded-md border px-2 py-1 text-xs whitespace-nowrap">
    <Icon className="text-muted-foreground size-3.5 shrink-0" />
    {label}
  </span>
);
