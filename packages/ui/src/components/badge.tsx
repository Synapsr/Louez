"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@louez/utils";

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button,a&]:cursor-pointer [button,a&]:pointer-coarse:after:absolute [button,a&]:pointer-coarse:after:size-full [button,a&]:pointer-coarse:after:min-h-11 [button,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "progress",
    },
    variants: {
      size: {
        default: "min-w-5.5 px-1 py-0.5 text-sm sm:min-w-4.5 sm:text-xs rounded-sm",
        lg: "min-w-6.5 px-2 py-1.5  text-base sm:min-w-5.5 sm:text-sm",
        sm: "h-5 min-w-5 rounded-[calc(var(--radius-sm)-2px)] px-[calc(var(--spacing)*1-1px)] text-xs sm:h-4 sm:min-w-4 sm:text-[.625rem]",
      },
      variant: {
        default: "bg-primary text-primary-foreground [button,a&]:hover:bg-primary/90",
        destructive: "bg-destructive text-white [button,a&]:hover:bg-destructive/90",
        error: "bg-destructive/8 text-destructive dark:bg-destructive/16",
        info: "bg-info/8 text-info dark:bg-info/16",
        outline:
          "border-input bg-background text-foreground dark:bg-input/32 [button,a&]:hover:bg-accent/50 dark:[button,a&]:hover:bg-input/48",
        pending: "bg-badge-pending-background text-badge-pending-foreground font-semibold",
        progress: "bg-badge-progress-background text-badge-progress-foreground font-semibold",
        // Discounts and offers: a strong neutral pill, distinct from the
        // status hues and safe on top of any tenant primary colour.
        promo: "bg-badge-promo-background text-badge-promo-foreground font-semibold",
        secondary: "bg-secondary text-secondary-foreground [button,a&]:hover:bg-secondary/90",
        submitted: "bg-badge-submitted-background text-badge-submitted-foreground font-semibold",
        review: "bg-badge-review-background text-badge-review-foreground font-semibold",
        success: "bg-badge-success-background text-badge-success-foreground font-semibold",
        tertiary: "bg-badge-gray-background text-badge-gray-foreground font-semibold",
        warning: "bg-badge-warning-background text-badge-warning-foreground font-semibold",
        failed: "bg-badge-failed-background text-badge-failed-foreground font-semibold",
        expired: "bg-badge-expired-background text-badge-expired-foreground font-semibold",
      },
    },
  },
);

interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

const Badge = ({ className, variant, size, render, ...props }: BadgeProps) => {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
};

export { Badge, badgeVariants };
