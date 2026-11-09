import type { ComponentType, SVGProps } from "react";

import { ChatGptIcon, ClaudeIcon, GrokIcon, LeChatIcon } from "@louez/ui/icons";

import { claudeConnectorLink } from "./util.assistant-links";

export type AssistantKey = "claude" | "chatgpt" | "grok" | "mistral";

export interface Assistant {
  key: AssistantKey;
  /** The brand name, the same in every language. */
  name: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Opens the assistant with Louez filled in; without it, the user pastes the address. */
  addLink?: (mcpUrl: string) => string;
  /** The assistant's page the first step opens, when it has one. */
  startUrl?: string;
}

/** The assistants that can connect to Louez, in the order they are offered. */
export const ASSISTANTS: readonly Assistant[] = [
  { key: "claude", name: "Claude", Icon: ClaudeIcon, addLink: claudeConnectorLink },
  { key: "chatgpt", name: "ChatGPT", Icon: ChatGptIcon, startUrl: "https://chatgpt.com/plugins" },
  { key: "grok", name: "Grok", Icon: GrokIcon, startUrl: "https://grok.com/connectors" },
  // Le Chat is called Vibe since August 2026.
  { key: "mistral", name: "Mistral Vibe", Icon: LeChatIcon, startUrl: "https://chat.mistral.ai" },
];
