"use client";
import { useEffect, useRef, useState } from "react";

export interface DemoCue {
  at: number;
  selector: string;
  click?: boolean;
  scroll?: { x: number; y: number; duration: number };
}
export const DEMO_DURATION = 4600;
export const DEMO_CUES = {
  storefront: [
    { at: 200, selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]' },
    {
      at: 1050,
      selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]',
      click: true,
    },
    { at: 1650, selector: '[data-slot="cart-line-item"] button[aria-label*="+1"]' },
    { at: 2350, selector: '[data-slot="cart-line-item"] button[aria-label*="+1"]', click: true },
    { at: 3000, selector: '[data-slot="cart-totals"]' },
  ],
  planning: [
    { at: 1900, selector: '[data-demo-target="departures"] button' },
    { at: 2800, selector: '[data-demo-target="departures"] button', click: true },
    { at: 4900, selector: '[data-reservations-view="calendar"]' },
    { at: 5800, selector: '[data-reservations-view="calendar"]', click: true },
    { at: 6900, selector: "[data-reservations-calendar-scroll]" },
    {
      at: 7500,
      selector: "[data-reservations-calendar-scroll]",
      scroll: { x: 540, y: 80, duration: 1300 },
    },
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
export const getDemoDuration = (scene: AnimatedScene) =>
  scene === "planning" ? 10200 : DEMO_DURATION;

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
  const scrollRef = useRef<{ element: HTMLElement; x: number; y: number; endAt: number } | null>(
    null,
  );
  const cursorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    clock.current = { elapsed: 0, cue: 0 };
    setPhase(0);
    scrollRef.current = null;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [scene, cycle]);
  useEffect(() => {
    const cursor = cursorRef.current;
    const animations =
      cursor?.getAnimations().filter((animation) => animation.id === "demo-cursor-move") ?? [];
    for (const animation of animations) {
      if (running) animation.play();
      else animation.pause();
    }
    if (!running) return;
    let frame = 0;
    let previous = performance.now();
    const cues: DemoCue[] = DEMO_CUES[scene];
    const tick = (now: number) => {
      const previousElapsed = clock.current.elapsed;
      clock.current.elapsed = advanceDemoClock(
        clock.current.elapsed,
        now - previous,
        getDemoDuration(scene),
      );
      const scroll = scrollRef.current;
      if (scroll) {
        const fraction = Math.min(
          1,
          (clock.current.elapsed - previousElapsed) / Math.max(1, scroll.endAt - previousElapsed),
        );
        const x = scroll.x * fraction;
        const y = scroll.y * fraction;
        scroll.element.scrollBy({ left: x, top: y, behavior: "instant" });
        scroll.x -= x;
        scroll.y -= y;
        if (fraction >= 1) scrollRef.current = null;
      }
      previous = now;
      const cue = cues[clock.current.cue];
      if (cue && clock.current.elapsed >= cue.at) {
        const target = document.querySelector<HTMLElement>(cue.selector);
        if (target && cursor) {
          let rect = target.getBoundingClientRect();
          const content = target.closest<HTMLElement>("[data-dashboard-content]");
          const bounds = content?.getBoundingClientRect();
          const top = bounds?.top ?? 0;
          const bottom = bounds?.bottom ?? window.innerHeight;
          if (rect.top < top || rect.bottom > bottom) {
            // Keep scrolling inside the app, without moving the surrounding landing.
            (content ?? window).scrollBy({
              top: rect.top - top - Math.max(24, (bottom - top - rect.height) / 2),
              behavior: "instant",
            });
            rect = target.getBoundingClientRect();
          }
          const x = rect.left + rect.width * 0.65;
          const y = rect.top + rect.height * 0.6;
          const destination = `translate(${x}px, ${y}px)`;
          const current = getComputedStyle(cursor).transform;
          for (const animation of cursor.getAnimations()) {
            if (animation.id === "demo-cursor-move") animation.cancel();
          }
          const movement = cursor.animate([{ transform: current }, { transform: destination }], {
            duration: cue.click ? 0 : 560,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "forwards",
          });
          movement.id = "demo-cursor-move";
          if (cue.click) target.click();
          if (cue.scroll)
            scrollRef.current = {
              element: target,
              x: cue.scroll.x,
              y: cue.scroll.y,
              endAt: clock.current.elapsed + cue.scroll.duration,
            };
        }
        clock.current.cue += 1;
        setPhase(clock.current.cue);
      }
      if (clock.current.elapsed >= getDemoDuration(scene)) {
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
