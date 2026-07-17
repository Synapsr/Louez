"use client";

import { GradientAvatar } from "@outpacelabs/avatars";

import { Avatar, AvatarFallback, AvatarImage } from "@louez/ui";
import { cn } from "@louez/utils";

interface UserAvatarProps {
  /** Image URL; when absent the deterministic gradient fallback is shown. */
  src?: string | null;
  /** Stable seed (e.g. the user id) — the same seed always yields the same gradient. */
  seed: string;
  /** Rendered size in pixels. Default: 32. */
  size?: number;
  className?: string;
}

export function UserAvatar({ src, seed, size = 32, className }: UserAvatarProps) {
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      <AvatarImage src={src || undefined} />
      <AvatarFallback className="p-0">
        <GradientAvatar seed={seed} radius="0" size={size} />
      </AvatarFallback>
    </Avatar>
  );
}
