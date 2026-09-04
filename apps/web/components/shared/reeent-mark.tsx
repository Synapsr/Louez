import { cn } from "@louez/utils";

/**
 * The reeent logo mark, copied from the marketplace favicon: the brand orange
 * tile with the white "r". Kept as inline SVG so it inherits the `--reeent`
 * token (lifted in dark mode) instead of the favicon's hardcoded hex.
 */
export const ReeentMark = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 32 32" className={cn("text-reeent shrink-0", className)}>
    <rect width="32" height="32" rx="7" fill="currentColor" />
    <g transform="translate(8.5, 25) scale(0.032, -0.032)" fill="#fff">
      <path d="M62 0V245V528H194L197 349H217Q224 419 243.5 460.5Q263 502 299.5 521.0Q336 540 390 540Q398 540 408.0 539.5Q418 539 431 537L425 365Q409 373 390.5 375.5Q372 378 358 378Q319 378 290.5 363.0Q262 348 245.5 317.0Q229 286 224 239V0Z" />
    </g>
  </svg>
);
