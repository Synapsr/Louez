"use client";
import { useEffect, useRef, useState } from "react";

export interface DemoCue {
  at: number;
  selector: string;
  click?: boolean;
}
export const DEMO_DURATION = 4600;
export const DEMO_CUES = {
  storefront: [
    { at: 200, selector: '[data-demo-target="product-0"] [data-slot="product-quick-add"]' },
    {
      at: 1050,
      selector: '[data-demo-target="product-0"] [data-slot="product-quick-add"]',
      click: true,
    },
    { at: 1550, selector: '[data-demo-target="options"] button[aria-label$="+1"]' },
    { at: 2300, selector: '[data-demo-target="options"] button[aria-label$="+1"]', click: true },
    { at: 2700, selector: '[data-demo-target="options"] [data-slot="dialog-footer"] button' },
    {
      at: 3750,
      selector: '[data-demo-target="options"] [data-slot="dialog-footer"] button',
      click: true,
    },
  ],
  planning: [
    { at: 450, selector: '[data-demo-target="departures"] button.group' },
    { at: 3650, selector: '[data-demo-target="departures"] button.group', click: true },
  ],
  reservation: [
    { at: 450, selector: '[data-demo-target="history"] button' },
    { at: 1900, selector: '[data-demo-target="history"] button', click: true },
  ],
  advisor: [
    { at: 500, selector: '[data-slot="advisor-suggestions"] button' },
    { at: 1700, selector: '[data-slot="advisor-suggestions"] button', click: true },
  ],
} satisfies Record<string, DemoCue[]>;
export type AnimatedScene = keyof typeof DEMO_CUES;

/** Advance only by active time, so a hover can pause in the middle of a gesture. */
export const advanceDemoClock = (
  elapsed: number,
  delta: number,
  duration = DEMO_DURATION,
): number => Math.min(duration, elapsed + Math.max(0, delta));

export const useDemoPlayback = ({
  scene,
  cycle,
  running,
  onFinish,
}: {
  scene: AnimatedScene;
  cycle: number;
  running: boolean;
  onFinish: () => void;
}) => {
  const clock = useRef({ elapsed: 0, cue: 0 });
  const cursorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    clock.current = { elapsed: 0, cue: 0 };
    setPhase(0);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [scene, cycle]);
  useEffect(() => {
    const cursor = cursorRef.current;
    const animations = cursor?.getAnimations() ?? [];
    for (const animation of animations) {
      if (running) animation.play();
      else animation.pause();
    }
    if (!running) return;
    let frame = 0;
    let previous = performance.now();
    const cues: DemoCue[] = DEMO_CUES[scene];
    const tick = (now: number) => {
      clock.current.elapsed = advanceDemoClock(clock.current.elapsed, now - previous);
      previous = now;
      const cue = cues[clock.current.cue];
      if (cue && clock.current.elapsed >= cue.at) {
        const target = document.querySelector<HTMLElement>(cue.selector);
        if (target && cursor) {
          let rect = target.getBoundingClientRect();
          if (rect.top < 0 || rect.bottom > window.innerHeight) {
            // Scroll only this document, never the landing around the iframe.
            window.scrollBy({
              top: rect.top - Math.max(24, (window.innerHeight - rect.height) / 2),
              behavior: "instant",
            });
            rect = target.getBoundingClientRect();
          }
          const x = rect.left + rect.width * 0.65;
          const y = rect.top + rect.height * 0.6;
          const destination = `translate(${x}px, ${y}px)`;
          const current = getComputedStyle(cursor).transform;
          for (const animation of cursor.getAnimations()) animation.cancel();
          cursor.animate([{ transform: current }, { transform: destination }], {
            duration: cue.click ? 0 : 560,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "forwards",
          });
          if (cue.click) target.click();
        }
        clock.current.cue += 1;
        setPhase(clock.current.cue);
      }
      if (clock.current.elapsed >= DEMO_DURATION) {
        finishRef.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, scene, cycle]);
  return { cursorRef, phase };
};
