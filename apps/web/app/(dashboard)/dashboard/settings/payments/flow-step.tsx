import { cn } from "@louez/utils";

interface FlowStepProps {
  number: number;
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  isActive?: boolean;
}

export const FlowStep = ({ number, icon: Icon, text, isActive }: FlowStepProps) => {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-all duration-300 ease-in-out",
        isActive ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all duration-300",
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted-foreground/20 text-muted-foreground",
        )}
      >
        {number}
      </div>
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-all duration-300",
          isActive ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span
        className={cn(
          "text-sm transition-all duration-300",
          isActive && "font-medium text-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
};
