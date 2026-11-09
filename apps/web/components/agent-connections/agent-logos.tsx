import { ChatGptIcon, ClaudeIcon, GrokIcon, LeChatIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

// Brand names, the same in every language.
const AGENTS = [
  { name: "Claude", Icon: ClaudeIcon },
  { name: "ChatGPT", Icon: ChatGptIcon },
  { name: "Grok", Icon: GrokIcon },
  { name: "Le Chat", Icon: LeChatIcon },
] as const;

/** The assistants that can connect to Louez, as a small stack of their marks. */
export const AgentLogos = ({ className }: { className?: string }) => (
  <ul className={cn("flex shrink-0 -space-x-1.5", className)}>
    {AGENTS.map(({ name, Icon }) => (
      <li
        key={name}
        className="bg-background text-foreground ring-border flex size-8 items-center justify-center rounded-full ring-1"
      >
        <Icon role="img" aria-label={name} className="size-4" />
      </li>
    ))}
  </ul>
);
