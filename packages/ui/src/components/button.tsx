"use client";

import {
  type CSSProperties,
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  isValidElement,
} from "react";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type VariantProps, cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { AnimatedIconSwap } from "@louez/ui/components/animated-icon-swap";
import { Spinner } from "@louez/ui/components/spinner";
import { cn } from "@louez/ui/lib/utils";

const buttonVariants = cva(
  [
    // structure & layout
    "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg",
    // cursor & interaction
    "cursor-pointer select-none",
    // border & background
    "border bg-clip-padding",
    // typography
    "text-xs font-medium whitespace-nowrap",
    // transitions
    "transition-[color,background-color,border-color,box-shadow,opacity,padding]",
    // outline / ring (focus)
    "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-1",
    // state: disabled
    "disabled:pointer-events-none disabled:opacity-50",
    // state: aria-invalid
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:ring-1",
    "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
    // nested icon svg
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // active state (for unpopuped button)
    "active:not-aria-[haspopup]:translate-y-px",
  ],
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        tertiary:
          "group border-transparent bg-muted text-muted-foreground aria-expanded:bg-muted aria-expanded:text-muted-foreground hover:bg-accent hover:text-foreground",
        ghost:
          "border-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-2.5 data-[icon-end=true]:pe-2 data-[icon-start=true]:ps-2",
        xs: "h-7 gap-1 px-2 text-xs data-[icon-end=true]:pe-1.5 data-[icon-start=true]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 data-[icon-end=true]:pe-1.5 data-[icon-start=true]:ps-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-2.5 data-[icon-end=true]:pe-3 data-[icon-start=true]:ps-3",
        xl: "h-12 gap-2 px-3.5 text-sm font-semibold data-[icon-end=true]:pe-4 data-[icon-start=true]:ps-4 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-9 rounded-lg",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11 rounded-lg",
        "icon-xl": "size-12 rounded-lg [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
    compoundVariants: [
      {
        size: ["icon", "icon-xs", "icon-sm", "icon-lg", "icon-xl"],
        className:
          "**:data-[slot=icon]:motion-safe:transition-transform **:data-[slot=icon]:motion-safe:duration-200 **:data-[slot=icon]:motion-safe:ease-[cubic-bezier(0.34,1.4,0.64,1)] **:data-[slot=icon]:motion-safe:group-hover/button:scale-105 **:data-[slot=icon]:motion-safe:group-focus-visible/button:scale-105 **:data-[slot=icon]:motion-safe:group-active/button:scale-95",
      },
    ],
  },
);

type IconElement = ReactElement<{ "data-slot"?: string; className?: string }>;

function isIconElement(child: ReactNode): child is IconElement {
  return isValidElement(child) && (child.props as { "data-slot"?: string })["data-slot"] === "icon";
}

// Children.forEach does not traverse into Fragments: `<>…</>` arrives as a
// single Fragment element, so its content must be flattened before scanning.
function flattenChildren(children: ReactNode): ReactNode[] {
  const flattened: ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      flattened.push(...flattenChildren(child.props.children));
      return;
    }

    flattened.push(child);
  });

  return flattened;
}

function splitChildren(children: ReactNode): {
  endIcon: IconElement | null;
  label: ReactNode[];
  startIcon: IconElement | null;
} {
  const label: ReactNode[] = [];
  let startIcon: IconElement | null = null;
  let endIcon: IconElement | null = null;

  for (const child of flattenChildren(children)) {
    if (isIconElement(child)) {
      // An icon before any content leads the label; one after it trails.
      if (startIcon === null && label.length === 0) {
        startIcon = child;
        continue;
      }
      if (endIcon === null) {
        endIcon = child;
        continue;
      }
    }

    label.push(child);
  }

  return { endIcon, label, startIcon };
}

const slotTransition = { type: "spring", duration: 0.3, bounce: 0 } as const;

// Motion animates the button's own width (layout), so the primitive is
// wrapped once at module level.
const MotionButtonPrimitive = motion.create(ButtonPrimitive);

// These props collide with motion's own props on the wrapped primitive, so
// they are excluded from the public API (`style` is re-added below without
// Base UI's state-callback form, which motion cannot handle).
type MotionConflictingProps = "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd" | "style";

type ButtonProps = Omit<ButtonPrimitive.Props, MotionConflictingProps> &
  VariantProps<typeof buttonVariants> & {
    isPending?: boolean;
    /** Replaces the label while `isPending` is true. */
    pendingContent?: ReactNode;
    pendingDisables?: boolean;
    style?: CSSProperties;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  isPending = false,
  pendingContent,
  pendingDisables = true,
  disabled,
  children,
  nativeButton,
  render,
  ...props
}: ButtonProps) {
  const shouldReduceMotion = useReducedMotion();
  const usesNativeButton = nativeButton ?? (render === undefined);

  const isIconOnly = size?.startsWith("icon") ?? false;
  const { endIcon, label, startIcon } = splitChildren(children);
  const hasIcon = startIcon !== null || endIcon !== null;
  const hasBothIcons = startIcon !== null && endIcon !== null;

  const iconClassName = startIcon?.props.className ?? endIcon?.props.className;

  // The spinner always lives at the inline start (left in LTR, right in RTL);
  // an inline-end icon slides away while pending.
  const startSlot =
    isPending || startIcon ? (
      <AnimatedIconSwap
        activeKey={isPending ? "pending" : "idle"}
        className={iconClassName}
        data-icon="inline-start"
      >
        {isPending ? <Spinner data-slot="icon" className={iconClassName} /> : startIcon}
      </AnimatedIconSwap>
    ) : null;

  const endSlot =
    endIcon && (!isPending || hasBothIcons) ? (
      <AnimatedIconSwap activeKey="idle" className={endIcon.props.className} data-icon="inline-end">
        {endIcon}
      </AnimatedIconSwap>
    ) : null;

  // Icon-only buttons without a slotted icon show just the spinner while pending.
  const hidesLabel = isPending && isIconOnly && !hasIcon;
  const idleLabel = hasIcon ? label : children;
  const content = hidesLabel
    ? null
    : isPending && pendingContent != null
      ? pendingContent
      : idleLabel;
  const hasLabel = Array.isArray(content) ? content.length > 0 : content != null;

  const layout = shouldReduceMotion ? false : ("position" as const);
  const hidden = (x: number) => (shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x });

  return (
    <MotionButtonPrimitive
      layout={shouldReduceMotion ? false : true}
      transition={slotTransition}
      data-slot="button"
      data-icon-start={startSlot ? true : undefined}
      data-icon-end={endSlot ? true : undefined}
      aria-busy={isPending || undefined}
      disabled={disabled || (isPending && pendingDisables)}
      className={cn(buttonVariants({ variant, size, className }))}
      nativeButton={usesNativeButton}
      render={render}
      {...props}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {startSlot ? (
          <motion.span
            key="start"
            layout={layout}
            initial={hidden(-6)}
            animate={{ opacity: 1, x: 0 }}
            exit={hidden(-6)}
            transition={slotTransition}
            className="flex items-center"
          >
            {startSlot}
          </motion.span>
        ) : null}
        {hasLabel ? (
          <motion.span
            key="label"
            layout={layout}
            transition={slotTransition}
            className="flex items-center gap-[inherit]"
          >
            {content}
          </motion.span>
        ) : null}
        {endSlot ? (
          <motion.span
            key="end"
            layout={layout}
            initial={hidden(6)}
            animate={{ opacity: 1, x: 0 }}
            exit={hidden(6)}
            transition={slotTransition}
            className="flex items-center"
          >
            {endSlot}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </MotionButtonPrimitive>
  );
}

export { Button, buttonVariants, type ButtonProps };
