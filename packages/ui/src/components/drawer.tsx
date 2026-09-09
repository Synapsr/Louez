"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";

import { cn } from "@louez/utils";

import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

type DrawerPosition = "right" | "left" | "top" | "bottom";

const DrawerContext = createContext<{ position: DrawerPosition }>({
  position: "bottom",
});
const DrawerKeyboardContext = createContext(false);

const useDrawerKeyboardOpen = () => useContext(DrawerKeyboardContext);

const directionMap: Record<DrawerPosition, DrawerPrimitive.Root.Props["swipeDirection"]> = {
  bottom: "down",
  left: "left",
  right: "right",
  top: "up",
};

function Drawer({
  swipeDirection,
  position = "bottom",
  ...props
}: DrawerPrimitive.Root.Props & {
  position?: DrawerPosition;
}) {
  return (
    <DrawerContext.Provider value={{ position }}>
      <DrawerPrimitive.Root swipeDirection={swipeDirection ?? directionMap[position]} {...props} />
    </DrawerContext.Provider>
  );
}

const DrawerPortal = DrawerPrimitive.Portal;

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerBackdrop({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/32 opacity-[calc(1-var(--drawer-swipe-progress))] backdrop-blur-sm transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-swiping:duration-0 supports-[-webkit-touch-callout:none]:absolute",
        className,
      )}
      data-slot="drawer-backdrop"
      {...props}
    />
  );
}

function DrawerViewport({
  className,
  position,
  style,
  variant = "default",
  ...props
}: DrawerPrimitive.Viewport.Props & {
  position: DrawerPosition;
  variant?: "default" | "straight" | "inset";
}) {
  const visualViewport = useVisualViewportBounds(position === "bottom");
  const viewportStyle = {
    ...style,
    "--drawer-visual-viewport-height": visualViewport.height
      ? `${visualViewport.height}px`
      : "100dvh",
    "--drawer-visual-viewport-top": `${visualViewport.offsetTop}px`,
  } as React.CSSProperties;

  return (
    <DrawerKeyboardContext.Provider value={visualViewport.keyboardOpen}>
      <DrawerPrimitive.Viewport
        className={cn(
          "fixed inset-x-0 top-(--drawer-visual-viewport-top,0px) bottom-auto z-50 h-(--drawer-visual-viewport-height,100dvh) touch-none [--bleed:--spacing(12)] [--inset:--spacing(0)]",
          position === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
          position === "top" && "grid grid-rows-[auto_1fr] pb-12",
          position === "left" && "flex justify-start",
          position === "right" && "flex justify-end",
          variant === "inset" && "px-(--inset) sm:[--inset:--spacing(4)]",
          variant === "inset" && position !== "bottom" && "pt-(--inset)",
          variant === "inset" && position !== "top" && "pb-(--inset)",
          className,
        )}
        data-slot="drawer-viewport"
        data-virtual-keyboard-open={visualViewport.keyboardOpen ? "" : undefined}
        style={viewportStyle}
        {...props}
      />
    </DrawerKeyboardContext.Provider>
  );
}

type VisualViewportBounds = {
  height: number;
  keyboardOpen: boolean;
  offsetTop: number;
};

const TEXT_ENTRY_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);
const VIRTUAL_KEYBOARD_MEDIA_QUERY = "(max-width: 639px)";

function isTextEntryElement(element: Element | null): boolean {
  return (
    (element instanceof HTMLInputElement &&
      !element.readOnly &&
      element.inputMode !== "none" &&
      TEXT_ENTRY_INPUT_TYPES.has(element.type)) ||
    (element instanceof HTMLTextAreaElement && !element.readOnly) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function useVisualViewportBounds(enabled: boolean): VisualViewportBounds {
  const [bounds, setBounds] = useState<VisualViewportBounds>({
    height: 0,
    keyboardOpen: false,
    offsetTop: 0,
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.visualViewport) {
      setBounds({ height: 0, keyboardOpen: false, offsetTop: 0 });
      return;
    }

    const visualViewport = window.visualViewport;
    const updateBounds = () => {
      const nextBounds = {
        height: Math.round(visualViewport.height),
        keyboardOpen:
          window.matchMedia(VIRTUAL_KEYBOARD_MEDIA_QUERY).matches &&
          isTextEntryElement(document.activeElement),
        offsetTop: Math.round(visualViewport.offsetTop),
      };

      setBounds((currentBounds) =>
        currentBounds.height === nextBounds.height &&
        currentBounds.keyboardOpen === nextBounds.keyboardOpen &&
        currentBounds.offsetTop === nextBounds.offsetTop
          ? currentBounds
          : nextBounds,
      );
    };

    let focusFrame = 0;
    const updateBoundsAfterFocusChange = () => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(updateBounds);
    };

    updateBounds();
    visualViewport.addEventListener("resize", updateBounds);
    visualViewport.addEventListener("scroll", updateBounds);
    document.addEventListener("focusin", updateBoundsAfterFocusChange);
    document.addEventListener("focusout", updateBoundsAfterFocusChange);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      visualViewport.removeEventListener("resize", updateBounds);
      visualViewport.removeEventListener("scroll", updateBounds);
      document.removeEventListener("focusin", updateBoundsAfterFocusChange);
      document.removeEventListener("focusout", updateBoundsAfterFocusChange);
    };
  }, [enabled]);

  return bounds;
}

function DrawerPopup({
  className,
  children,
  showCloseButton = false,
  showHandle = true,
  position: positionProp,
  variant = "default",
  ...props
}: DrawerPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  showHandle?: boolean;
  position?: DrawerPosition;
  variant?: "default" | "straight" | "inset";
}) {
  const { position: contextPosition } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;

  return (
    <DrawerPortal>
      <DrawerBackdrop />
      <DrawerViewport position={position} variant={variant}>
        <DrawerPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover text-popover-foreground shadow-lg/5 outline-none transition-[transform,box-shadow,height,background-color] duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform [--inset:--spacing(0)] before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] after:pointer-events-none after:absolute after:bg-popover data-swiping:select-none data-ending-style:shadow-transparent data-starting-style:shadow-transparent data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            "touch-none max-sm:in-data-virtual-keyboard-open:!block max-sm:in-data-virtual-keyboard-open:overflow-y-auto max-sm:in-data-virtual-keyboard-open:overscroll-none max-sm:in-data-virtual-keyboard-open:touch-pan-y max-sm:in-data-virtual-keyboard-open:[&>form]:!contents",
            // Once the popup is its own scroll container, the overscroll bleed
            // strip (`after:top-full`) resolves against the *visible* height
            // and scrolls with the content — an opaque 48px band gliding over
            // whatever you scroll past. No swipe happens while typing anyway.
            "max-sm:in-data-virtual-keyboard-open:after:hidden max-sm:in-data-virtual-keyboard-open:before:hidden",
            position === "bottom" &&
              "row-start-2 border-t data-ending-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] data-starting-style:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)+var(--inset)))] transform-[translateY(var(--drawer-swipe-movement-y))] after:inset-x-0 after:top-full after:h-(--bleed)",
            position === "top" &&
              "border-b data-ending-style:transform-[translateY(calc(-100%-var(--inset)))] data-starting-style:transform-[translateY(calc(-100%-var(--inset)))] transform-[translateY(var(--drawer-swipe-movement-y))] after:inset-x-0 after:bottom-full after:h-(--bleed)",
            position === "left" &&
              "w-[calc(100%-(--spacing(12)))] max-w-md border-e data-ending-style:transform-[translateX(calc(-100%-var(--inset)))] data-starting-style:transform-[translateX(calc(-100%-var(--inset)))] transform-[translateX(var(--drawer-swipe-movement-x))] after:inset-y-0 after:end-full after:w-(--bleed)",
            position === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md border-s data-ending-style:transform-[translateX(calc(100%+var(--inset)))] data-starting-style:transform-[translateX(calc(100%+var(--inset)))] transform-[translateX(var(--drawer-swipe-movement-x))] after:inset-y-0 after:start-full after:w-(--bleed)",
            variant !== "straight" &&
              cn(
                position === "bottom" && "rounded-t-2xl",
                position === "top" && "rounded-b-2xl",
                position === "left" && "rounded-e-2xl",
                position === "right" && "rounded-s-2xl",
              ),
            variant === "default" &&
              cn(
                position === "bottom" && "before:rounded-t-[calc(var(--radius-2xl)-1px)]",
                position === "top" && "before:rounded-b-[calc(var(--radius-2xl)-1px)]",
                position === "left" && "before:rounded-e-[calc(var(--radius-2xl)-1px)]",
                position === "right" && "before:rounded-s-[calc(var(--radius-2xl)-1px)]",
              ),
            variant === "inset" &&
              // The viewport's gap has to travel with the exit transform, or
              // the popup stops a gap's width short of the edge and the last
              // sliver of it snaps away instead of sliding out.
              "before:hidden sm:rounded-2xl sm:border sm:[--inset:--spacing(4)] sm:after:bg-transparent sm:before:rounded-[calc(var(--radius-2xl)-1px)]",
            className,
          )}
          data-slot="drawer-popup"
          {...props}
        >
          {/* Grab handle: the whole popup is swipeable, so this is a hint and
              nothing more — it must not swallow the swipe it advertises.
              Sticky, not fixed: it belongs to the sheet and has to travel with
              the swipe transform, and it stays pinned to the top edge once the
              virtual keyboard turns the popup itself into the scroll container.
              The negative bottom margin cancels its own footprint, so the
              header keeps its own top padding.
              Hidden when the sheet can't be swiped away — a handle that
              advertises a dismissal the sheet refuses is worse than none. */}
          {position === "bottom" && showHandle && (
            <div
              aria-hidden
              className="pointer-events-none sticky top-2 z-10 mx-auto mt-2 -mb-3 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/25 transition-colors in-data-swiping:bg-muted-foreground/40"
              data-slot="drawer-handle"
            />
          )}
          {children}
          {showCloseButton && (
            <DrawerPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={
                // Ghost reads as nothing on a busy sheet; on the phone the
                // close adopts the tertiary look (muted disc), as native
                // sheets do. Desktop side drawers keep the quiet ghost.
                <Button
                  className="max-sm:size-11 max-sm:bg-muted max-sm:text-muted-foreground"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <XIcon />
            </DrawerPrimitive.Close>
          )}
        </DrawerPrimitive.Popup>
      </DrawerViewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex cursor-default flex-col gap-2 p-6 in-[[data-slot=drawer-popup]:has([data-slot=drawer-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="drawer-header"
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-4 sm:flex-row sm:justify-end sm:px-6",
        // Mobile actions read as a native bottom sheet: full-width stacked
        // buttons on the same inset as the header, ending just above the home
        // indicator instead of a safe area stacked on top of a padding.
        "max-sm:gap-1 max-sm:px-6 max-sm:pt-4 max-sm:pb-[max(calc(env(safe-area-inset-bottom,0px)+--spacing(2)),--spacing(6))]",
        // Scrolling above the keyboard, the safe area is covered anyway — a
        // plain padding keeps the end of the scroll from feeling hollow.
        "max-sm:in-data-virtual-keyboard-open:pb-4!",
        "max-sm:**:data-[slot=button]:h-12 max-sm:**:data-[slot=button]:w-full max-sm:**:data-[slot=button]:rounded-xl",
        "max-sm:**:data-[slot=button]:text-sm max-sm:**:data-[slot=button]:font-semibold",
        variant === "default" &&
          // The toolbar band is a desktop affordance; on the phone the actions
          // sit directly on the sheet surface, as native sheets do. The
          // `border-t` class stays as the marker the panel spacing keys on.
          "border-t bg-muted/72 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(3))] max-sm:border-t-0 max-sm:bg-transparent sm:pt-4 sm:pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]",
        variant === "bare" &&
          "in-[[data-slot=drawer-popup]:has([data-slot=drawer-panel])]:pt-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))] sm:pt-4 sm:pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(6))]",
        className,
      )}
      data-slot="drawer-footer"
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      className={cn("font-heading text-xl leading-none font-semibold", className)}
      data-slot="drawer-title"
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="drawer-description"
      {...props}
    />
  );
}

function DrawerPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  const keyboardOpen = useDrawerKeyboardOpen();

  return (
    <ScrollArea
      className={cn("touch-auto", keyboardOpen && "!contents")}
      scrollFade={!keyboardOpen && scrollFade}
      scrollbarClassName={cn(keyboardOpen && "!hidden")}
      viewportClassName={cn(keyboardOpen && "!contents !mask-none")}
    >
      <div
        className={cn(
          "p-6 in-[[data-slot=drawer-popup]:has([data-slot=drawer-header])]:pt-1 in-[[data-slot=drawer-popup]:has([data-slot=drawer-footer]:not(.border-t))]:pb-1",
          // On the phone every footer is bandless, so the bare spacing applies
          // even when the `border-t` marker is present for larger screens.
          "max-sm:in-[[data-slot=drawer-popup]:has([data-slot=drawer-footer])]:pb-1",
          className,
        )}
        data-slot="drawer-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
  useDrawerKeyboardOpen,
};
