import { ChatGptIcon, ClaudeIcon, GrokIcon, LeChatIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

// Brand names, the same in every language.
const AGENTS = [
  { name: "Claude", Icon: ClaudeIcon },
  { name: "ChatGPT", Icon: ChatGptIcon },
  { name: "Grok", Icon: GrokIcon },
  { name: "Mistral Vibe", Icon: LeChatIcon },
] as const;

/**
 * The assistants that can connect to Louez, as one tight stack of their marks,
 * each badge cut out of the one before by a ring of the page's background:
 * Claude and Mistral Vibe in their colors, ChatGPT and Grok in the text
 * color, as their brands ask. The overlap (6px) stays under each mark's
 * margin in its badge (7px), so no mark is covered. All four keep the same
 * badge, Mistral's included, so the stack reads as one group.
 */
export const AgentLogos = ({ className }: { className?: string }) => (
  <ul className={cn("flex shrink-0 -space-x-1.5", className)}>
    {AGENTS.map(({ name, Icon }) => (
      <li
        key={name}
        className="bg-background text-foreground border-border ring-background flex size-7 items-center justify-center rounded-full border ring-2"
      >
        <Icon role="img" aria-label={name} className="size-3.5" />
      </li>
    ))}
  </ul>
);
