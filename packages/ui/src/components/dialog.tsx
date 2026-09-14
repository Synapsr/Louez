"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { cn } from "@louez/utils";

import {
  type DialogMobileVariant,
  DialogModeContext,
  useDialogMode,
  useResolvedDialogMode,
} from "@louez/ui/hooks/use-dialog-mode";

import { Button } from "./button";
import {
  DrawerBackdrop,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
  useDrawerKeyboardOpen,
} from "./drawer";
import { ScrollArea } from "./scroll-area";

type DialogChangeEventDetails =
  | DialogPrimitive.Root.ChangeEventDetails
  | DrawerPrimitive.Root.ChangeEventDetails;
type DialogProps<Payload = unknown> = Omit<DialogPrimitive.Root.Props<Payload>, "onOpenChange"> & {
  mobileVariant?: DialogMobileVariant;
  onOpenChange?: (open: boolean, eventDetails: DialogChangeEventDetails) => void;
};

const getDialogPopupState = (state: DrawerPrimitive.Popup.State): DialogPrimitive.Popup.State => ({
  nested: state.nested,
  nestedDialogOpen: state.nestedDrawerOpen,
  open: state.open,
  transitionStatus: state.transitionStatus,
});

const DialogCreateHandle = DialogPrimitive.createHandle;

// Width utilities a desktop dialog carries (`w-[95vw]`, `max-w-lg`, `min-w-*`)
// mean nothing once the same component renders as a bottom sheet.
const DRAWER_WIDTH_RESET = "max-sm:w-full max-sm:min-w-0 max-sm:max-w-none";

const Dialog = <Payload,>({
  defaultOpen = false,
  mobileVariant = "drawer",
  onOpenChange,
  open: openProp,
  ...props
}: DialogProps<Payload>) => {
  const mode = useResolvedDialogMode(mobileVariant);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const openProps = openProp === undefined ? { defaultOpen: uncontrolledOpen } : { open: openProp };

  const handleDialogOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails,
  ) => {
    if (openProp === undefined) {
      setUncontrolledOpen(open);
    }

    onOpenChange?.(open, eventDetails);
  };

  const handleDrawerOpenChange = (
    open: boolean,
    eventDetails: DrawerPrimitive.Root.ChangeEventDetails,
  ) => {
    if (openProp === undefined) {
      setUncontrolledOpen(open);
    }

    onOpenChange?.(open, eventDetails);
  };

  return (
    <DialogModeContext.Provider value={mode}>
      {mode === "drawer" ? (
        <DrawerPrimitive.Root
          {...props}
          {...openProps}
          onOpenChange={handleDrawerOpenChange}
          swipeDirection="down"
        />
      ) : (
        <DialogPrimitive.Root {...props} {...openProps} onOpenChange={handleDialogOpenChange} />
      )}
    </DialogModeContext.Provider>
  );
};

const DialogPortal = (props: DialogPrimitive.Portal.Props) => {
  const mode = useDialogMode();

  return mode === "drawer" ? <DrawerPortal {...props} /> : <DialogPrimitive.Portal {...props} />;
};

const DialogTrigger = (props: DialogPrimitive.Trigger.Props) => {
  const mode = useDialogMode();

  return mode === "drawer" ? (
    <DrawerPrimitive.Trigger data-slot="dialog-trigger" {...props} />
  ) : (
    <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
  );
};

const DialogClose = (props: DialogPrimitive.Close.Props) => {
  const mode = useDialogMode();

  return mode === "drawer" ? (
    <DrawerPrimitive.Close data-slot="dialog-close" {...props} />
  ) : (
    <DialogPrimitive.Close data-slot="dialog-close" {...props} />
  );
};

const DialogBackdrop = ({ className, ...props }: DialogPrimitive.Backdrop.Props) => {
  const mode = useDialogMode();

  if (mode === "drawer") {
    return <DrawerBackdrop className={className} data-slot="dialog-backdrop" {...props} />;
  }

  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
};

const DialogViewport = ({ className, ...props }: DialogPrimitive.Viewport.Props) => {
  const mode = useDialogMode();

  if (mode === "drawer") {
    return (
      <DrawerViewport
        className={className}
        data-slot="dialog-viewport"
        position="bottom"
        {...props}
      />
    );
  }

  return (
    <DialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
};

const DialogPopup = ({
  className,
  children,
  showCloseButton = true,
  showHandle = true,
  bottomStickOnMobile = true,
  render,
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  showHandle?: boolean;
  bottomStickOnMobile?: boolean;
}) => {
  const mode = useDialogMode();

  if (mode === "drawer") {
    return (
      <DrawerPopup
        {...props}
        // A bottom sheet always spans the full width: a `w-[95vw]` or
        // `max-w-*` meant for the desktop dialog would otherwise leave it
        // hanging off to one side. The `max-sm:` variants win over the
        // consumer's unprefixed utilities by source order, whatever `cn()`
        // keeps of them.
        className={
          typeof className === "function"
            ? (state) => cn(DRAWER_WIDTH_RESET, className(getDialogPopupState(state)))
            : cn(DRAWER_WIDTH_RESET, className)
        }
        data-slot="dialog-popup"
        position="bottom"
        render={
          typeof render === "function"
            ? (renderProps, state) => render(renderProps, getDialogPopupState(state))
            : render
        }
        showCloseButton={showCloseButton}
        showHandle={showHandle}
        style={typeof style === "function" ? (state) => style(getDialogPopupState(state)) : style}
      >
        {children}
      </DrawerPopup>
    );
  }

  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport
        className={cn(bottomStickOnMobile && "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12")}
      >
        <DialogPrimitive.Popup
          className={cn(
            "-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative row-start-2 flex max-h-full min-h-0 w-full min-w-0 max-w-lg scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground opacity-[calc(1-0.1*var(--nested-dialogs))] shadow-lg/5 transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            bottomStickOnMobile &&
              "max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 max-sm:before:hidden max-sm:before:rounded-none",
            className,
          )}
          data-slot="dialog-popup"
          render={render}
          style={style}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={
                <Button
                  className="max-sm:size-11 max-sm:bg-muted max-sm:text-muted-foreground"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
};

const DialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4",
      className,
    )}
    data-slot="dialog-header"
    {...props}
  />
);

const DialogFooter = ({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) => {
  const mode = useDialogMode();

  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-4 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)] sm:px-6",
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
          // The toolbar band is a desktop affordance; as a sheet the actions
          // sit directly on the surface, as native sheets do. No `border-t`
          // here also gives the panel its bare (tight) bottom padding.
          (mode === "drawer" ? "pt-3" : "border-t bg-muted/72 py-3"),
        variant === "bare" &&
          (mode === "drawer"
            ? "in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pt-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]"
            : "in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pt-3 pt-3 pb-4 sm:pt-4 sm:pb-6"),
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
};

const DialogTitle = ({ className, ...props }: DialogPrimitive.Title.Props) => {
  const mode = useDialogMode();
  const titleClassName = cn("font-heading font-semibold text-xl leading-none", className);

  return mode === "drawer" ? (
    <DrawerPrimitive.Title className={titleClassName} data-slot="dialog-title" {...props} />
  ) : (
    <DialogPrimitive.Title className={titleClassName} data-slot="dialog-title" {...props} />
  );
};

const DialogDescription = ({ className, ...props }: DialogPrimitive.Description.Props) => {
  const mode = useDialogMode();
  const descriptionClassName = cn("text-muted-foreground text-sm", className);

  return mode === "drawer" ? (
    <DrawerPrimitive.Description
      className={descriptionClassName}
      data-slot="dialog-description"
      {...props}
    />
  ) : (
    <DialogPrimitive.Description
      className={descriptionClassName}
      data-slot="dialog-description"
      {...props}
    />
  );
};

const DialogPanel = ({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) => {
  const mode = useDialogMode();
  const keyboardOpen = useDrawerKeyboardOpen();
  const useKeyboardLayout = mode === "drawer" && keyboardOpen;

  return (
    <ScrollArea
      className={cn(mode === "drawer" && "touch-auto", useKeyboardLayout && "!contents")}
      scrollFade={!useKeyboardLayout && scrollFade}
      scrollbarClassName={cn(useKeyboardLayout && "!hidden")}
      viewportClassName={cn(useKeyboardLayout && "!contents !mask-none")}
    >
      <div
        className={cn(
          "p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
};

export {
  DialogCreateHandle,
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogViewport,
};
