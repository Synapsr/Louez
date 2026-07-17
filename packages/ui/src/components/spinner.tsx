import { Loader2Icon, LoaderIcon } from "lucide-react";
import type React from "react";
import { cn } from "@louez/ui/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <LoaderIcon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
