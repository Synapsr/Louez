"use client";

import { type ComponentProps, type ReactNode, useId } from "react";

import { cn } from "@louez/utils";

import { GlassIllustration } from "@/components/dashboard/shared/glass-illustration";

import { type HomeStory, HomeEmptyStory } from "./home-empty-story";

interface HomeEmptyStateProps {
  illustration: Pick<ComponentProps<typeof GlassIllustration>, "main" | "companions">;
  title: string;
  /** A sentence, or a link when the state points somewhere (the next busy day). */
  description: ReactNode;
  /** The one action the state leads to, if any. */
  action?: ReactNode;
  /** `compact` for "nothing to do" states, the full size for "not yet" ones. */
  size?: "full" | "compact";
  /** A compact state's little story, told once around its icon. */
  story?: HomeStory;
}

/**
 * The single empty state of the home cards. A card is either "not yet" (the
 * store is new: it says what will appear and leads to one action), "nothing to
 * do" (compact, no action) or its content. It centres in the card's height.
 */
export const HomeEmptyState = ({
  illustration,
  title,
  description,
  action,
  size = "full",
  story,
}: HomeEmptyStateProps) => {
  const id = useId();
  const Main = illustration.main;

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center text-center",
        size === "full" ? "gap-5 px-4 py-10" : "gap-3 px-4 py-6",
      )}
    >
      {size === "full" ? (
        <GlassIllustration {...illustration} />
      ) : story ? (
        <HomeEmptyStory story={story} main={Main} />
      ) : (
        <Main uniqueId={`${id}-main`} size={56} className="animate-enter" />
      )}
      <div className="flex max-w-sm flex-col items-center gap-1.5">
        <p
          className={cn(
            "font-bold tracking-tight text-balance",
            size === "full" ? "text-lg" : "text-base",
          )}
        >
          {title}
        </p>
        <p className="text-muted-foreground text-sm text-balance">{description}</p>
      </div>
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
};
