import { ChatGptIcon, ClaudeIcon, GrokIcon, LeChatIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

// Brand names, the same in every language.
const AGENTS = [
  { name: "Claude", Icon: ClaudeIcon },
  { name: "ChatGPT", Icon: ChatGptIcon },
  { name: "Grok", Icon: GrokIcon },
  { name: "Le Chat", Icon: LeChatIcon },
] as const;

/**
 * The assistants that can connect to Louez, as a small stack of their marks:
 * Claude and Le Chat in their colors, ChatGPT and Grok in the text color, as
 * their brands ask.
 */
export const AgentLogos = ({ className }: { className?: string }) => (
  <ul className={cn("flex shrink-0 -space-x-1", className)}>
    {AGENTS.map(({ name, Icon }) => (
      <li
        key={name}
        className="bg-background text-foreground ring-border flex size-6 items-center justify-center rounded-full ring-1"
      >
        <Icon role="img" aria-label={name} className="size-3.5" />
      </li>
    ))}
  </ul>
);
