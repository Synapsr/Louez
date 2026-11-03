"use client";

import { useLayoutEffect, useRef } from "react";

import { useAnimate, useReducedMotion } from "framer-motion";

/** Strong ease-out: the step lands fast, then settles. */
const EASE_OUT = [0.19, 1, 0.22, 1] as const;
const OFFSET_PX = 16;

interface StepTransitionProps {
  /** Changes with the step: a new value plays the entrance. */
  stepKey: string;
  /** Position of the step in the flow, to slide forward or back. */
  stepIndex: number;
  /** False for a plain fade and blur, without the slide. */
  slide?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Brings each onboarding step in with a short slide, fade and blur: from the
 * right when the flow moves forward, from the left when it goes back. The
 * first step of a page load shows as is. Only the entrance animates: the step
 * being left stays on screen until the next one is ready, then gives way.
 * With reduced motion, the step only fades in.
 *
 * The wrapper is animated in place rather than re-keyed, so the router below
 * it is never remounted and keeps the steps it holds.
 */
export const StepTransition = ({
  stepKey,
  stepIndex,
  slide = true,
  className,
  children,
}: StepTransitionProps) => {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const shouldReduceMotion = useReducedMotion();
  const shown = useRef({ key: stepKey, index: stepIndex });

  // Layout effect: the new step's first frame already starts from its offset.
  useLayoutEffect(() => {
    if (shown.current.key === stepKey) return;
    const direction = slide ? (stepIndex < shown.current.index ? -1 : 1) : 0;
    shown.current = { key: stepKey, index: stepIndex };

    if (shouldReduceMotion) {
      void animate(scope.current, { opacity: [0, 1] }, { duration: 0.2, ease: EASE_OUT });
      return;
    }

    void animate(
      scope.current,
      {
        opacity: [0, 1],
        transform: [`translateX(${direction * OFFSET_PX}px)`, "translateX(0px)"],
        filter: ["blur(4px)", "blur(0px)"],
      },
      { duration: 0.4, ease: EASE_OUT },
    ).then(() => {
      // A leftover transform or filter would make this wrapper the containing
      // block of fixed-position descendants.
      if (!scope.current) return;
      scope.current.style.transform = "";
      scope.current.style.filter = "";
    });
  }, [animate, scope, shouldReduceMotion, slide, stepIndex, stepKey]);

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
};
