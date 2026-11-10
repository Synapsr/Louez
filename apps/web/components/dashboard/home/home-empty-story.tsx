"use client";

import { type ComponentType, useEffect, useId, useState } from "react";

import { motion, type Transition, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Bike, Check } from "lucide-react";

import type { GlassIconProps } from "@louez/ui/icons/glass";

/**
 * The little stories the home's empty states tell, once:
 * - `upToDate`: the last request slides into the calendar and is ticked off.
 * - `quietDay`: a sun crosses the sky behind the shop — a day going by calmly.
 * - `firstDay`: a hand-over leaves, a return comes back.
 */
export type HomeStory = "upToDate" | "quietDay" | "firstDay";

type GlassIcon = ComponentType<GlassIconProps & { uniqueId?: string }>;

/** The longest story, delays included, before the scene settles for good. */
const STORY_MS = 2400;
/** Every so many clicks on the quiet day, a bike rides by. */
const BIKE_CLICKS = 3;
const SEEN_KEY = "louez:home-story-seen:";

const hasSeen = (story: HomeStory): boolean => {
  try {
    return window.sessionStorage.getItem(SEEN_KEY + story) === "1";
  } catch {
    return false;
  }
};

const markSeen = (story: HomeStory) => {
  try {
    window.sessionStorage.setItem(SEEN_KEY + story, "1");
  } catch {
    // Without storage the story simply plays again next time.
  }
};

interface HomeEmptyStoryProps {
  story: HomeStory;
  /** The empty state's glass icon, the scene's still subject. */
  main: GlassIcon;
}

/**
 * The illustration of a home empty state, with its story. It plays once a
 * session, then the scene rests on its last frame — no idle loop, nothing
 * floating: a back-office screen is read for minutes. A click on the scene
 * plays it again; the quiet day keeps one more surprise for the curious.
 * With reduced motion the last frame shows straight away.
 */
export const HomeEmptyStory = ({ story, main: Main }: HomeEmptyStoryProps) => {
  const id = useId();
  const reducedMotion = useReducedMotion() ?? false;
  // At rest until mounted: the server and the first render show the last frame.
  const [playing, setPlaying] = useState(false);
  // Each run remounts the moving parts, so they start over from their first frame.
  const [runId, setRunId] = useState(0);
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    if (reducedMotion || hasSeen(story)) return;
    markSeen(story);
    setPlaying(true);
  }, [reducedMotion, story]);

  // Back to the still frame once the story is told, so a later re-render
  // (the home refreshes itself) never plays it again.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setPlaying(false), STORY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, runId]);

  const replay = () => {
    if (reducedMotion) return;
    setClicks((count) => count + 1);
    setRunId((count) => count + 1);
    setPlaying(true);
  };

  const key = `${story}-${runId}`;
  /**
   * One moving part: playing, it runs its frames; at rest, it sits on its last
   * one without moving at all.
   */
  const scene = ({
    frames,
    rest,
    transition,
  }: {
    frames: Record<string, number[]>;
    rest: Record<string, number>;
    transition: Transition;
  }) =>
    playing
      ? {
          initial: Object.fromEntries(
            Object.entries(frames).map(([prop, values]) => [prop, values[0]]),
          ),
          animate: frames,
          transition,
        }
      : { initial: false as const, animate: rest };

  return (
    <div aria-hidden className="relative h-16 w-28 cursor-default select-none" onClick={replay}>
      {story === "quietDay" && (
        <motion.span
          key={`sun-${key}`}
          className="absolute top-1/2 left-1/2 size-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_3px] shadow-amber-300/50"
          {...scene({
            frames: { x: [-46, -6, 22], y: [10, -30, -26], opacity: [0, 1, 1] },
            rest: { x: 22, y: -26, opacity: 1 },
            transition: { duration: 1.8, delay: 0.3, ease: "easeOut", times: [0, 0.6, 1] },
          })}
        />
      )}

      <Main
        uniqueId={`${id}-main`}
        size={56}
        className="animate-enter absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      />

      {story === "upToDate" && (
        <>
          <motion.span
            key={`request-${key}`}
            className="bg-card shadow-raised absolute top-1/2 left-1/2 flex h-3.5 w-5 flex-col justify-center gap-0.5 rounded-[3px] px-1"
            {...scene({
              frames: {
                x: [-58, -10, -10],
                y: [-7, -7, -7],
                opacity: [0, 1, 0],
                scale: [1, 1, 0.4],
              },
              rest: { x: -10, y: -7, opacity: 0, scale: 0.4 },
              transition: { duration: 1, delay: 0.25, ease: "easeInOut", times: [0, 0.65, 1] },
            })}
          >
            <span className="bg-primary/60 h-0.5 w-full rounded-full" />
            <span className="bg-primary/30 h-0.5 w-2/3 rounded-full" />
          </motion.span>
          <motion.span
            key={`check-${key}`}
            className="bg-success ring-card absolute top-0.5 right-6 flex size-4.5 items-center justify-center rounded-full text-white ring-2"
            {...scene({
              frames: { scale: [0, 1] },
              rest: { scale: 1 },
              transition: { type: "spring", stiffness: 420, damping: 16, delay: 1.2 },
            })}
          >
            <Check className="size-3" strokeWidth={3} />
          </motion.span>
        </>
      )}

      {story === "firstDay" && (
        <>
          <motion.span
            key={`leave-${key}`}
            className="bg-success ring-card absolute top-1/2 left-1/2 flex size-4.5 items-center justify-center rounded-full text-white ring-2"
            {...scene({
              frames: { x: [-9, 24], y: [-9, -26], opacity: [0, 1] },
              rest: { x: 24, y: -26, opacity: 1 },
              transition: { duration: 0.7, delay: 0.3, ease: "easeOut" },
            })}
          >
            <ArrowUpRight className="size-3" strokeWidth={3} />
          </motion.span>
          <motion.span
            key={`back-${key}`}
            className="bg-primary ring-card absolute top-1/2 left-1/2 flex size-4.5 items-center justify-center rounded-full text-white ring-2"
            {...scene({
              frames: { x: [40, -40], y: [22, 8], opacity: [0, 1] },
              rest: { x: -40, y: 8, opacity: 1 },
              transition: { duration: 0.9, delay: 1.1, ease: "easeInOut" },
            })}
          >
            <ArrowDownRight className="size-3" strokeWidth={3} />
          </motion.span>
        </>
      )}

      {story === "quietDay" && clicks > 0 && clicks % BIKE_CLICKS === 0 && (
        <motion.span
          key={`bike-${clicks}`}
          className="text-primary/70 absolute bottom-0 left-0"
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: [-24, 60, 130], opacity: [0, 1, 0] }}
          transition={{ duration: 2.2, ease: "linear", times: [0, 0.5, 1] }}
        >
          <Bike className="size-3.5" />
        </motion.span>
      )}
    </div>
  );
};
