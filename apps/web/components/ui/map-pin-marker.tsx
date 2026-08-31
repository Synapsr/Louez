import { cn } from "@louez/utils";

interface MapPinMarkerProps {
  color: string;
  draggable?: boolean;
  size?: "small" | "medium";
}

export const MapPinMarker = ({ color, draggable = false, size = "medium" }: MapPinMarkerProps) => {
  const marker = (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 40"
      className={cn(
        "drop-shadow-[0_3px_6px_rgba(0,0,0,0.3)]",
        size === "small" ? "h-8 w-7" : "h-10 w-8",
      )}
    >
      <path
        d="M16 0C7.163 0 0 7.163 0 16C0 24.837 16 40 16 40C16 40 32 24.837 32 16C32 7.163 24.837 0 16 0Z"
        fill="currentColor"
      />
      <circle cx="16" cy="16" r="6" fill="white" />
    </svg>
  );

  return (
    <div
      aria-hidden="true"
      className={draggable ? "cursor-grab active:cursor-grabbing" : undefined}
      style={{ color }}
    >
      {marker}
    </div>
  );
};
