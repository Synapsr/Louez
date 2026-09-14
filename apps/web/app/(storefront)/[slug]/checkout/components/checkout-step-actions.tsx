"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { StickyActionBar } from "@/components/storefront/ui/sticky-action-bar";

/**
 * The checkout's bottom action row: back on the left, the step's primary
 * button on the right.
 *
 * The store footer sits below the form, so a `sticky` bar would land on its
 * own a footer's height before the end of the page and scroll out of sight
 * with the content. This one is `fixed` on phones and gives the page back the
 * height it takes with a spacer past the footer, so nothing hides behind it.
 *
 * It must not be rendered inside `StepContent`: the animated wrapper carries a
 * `filter` and a `will-change`, and either one makes it the containing block
 * of a fixed child.
 */
export const CheckoutStepActions = ({ children }: { children: ReactNode }) => {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => setPortalTarget(document.body), []);

  return (
    <>
      <StickyActionBar placement="fixed" className="justify-between">
        {children}
      </StickyActionBar>
      {portalTarget
        ? createPortal(
            <div
              aria-hidden="true"
              className="h-[calc(--spacing(24)+env(safe-area-inset-bottom,0px))] shrink-0 lg:hidden"
            />,
            portalTarget,
          )
        : null}
    </>
  );
};
