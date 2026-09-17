"use client";
import { useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Button } from "@louez/ui";
import { SparklesIcon } from "@louez/ui/icons";
import { AdvisorPanel } from "@/components/storefront/advisor/advisor-panel";
import { demoAdvisorReply } from "@/lib/landing-demos/fixtures";
import { useDemoLocale } from "./use-demo-locale";

export const AdvisorScene = ({ visible }: { visible: boolean }) => {
  const locale = useDemoLocale();
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  return (
    <div data-demo-scene="advisor">
      <div className="grid min-h-80 place-items-center">
        <Button onClick={() => setOpen(true)}>
          <SparklesIcon />
          Louez IA
        </Button>
      </div>
      <AdvisorPanel
        autoFocus={false}
        modal={false}
        isOpen={open && visible}
        onClose={() => setOpen(false)}
        displayName="Louez IA"
        intent={null}
        onIntentConsumed={() => {}}
        messages={messages}
        isLoading={false}
        hasError={false}
        errorCode=""
        onRestart={() => setMessages([])}
        onSend={(text) =>
          setMessages((current) => [
            ...current,
            {
              id: `demo-question-${current.length}`,
              role: "user",
              parts: [{ type: "text", text }],
            },
            demoAdvisorReply(`demo-answer-${current.length}`, locale),
          ])
        }
      />
    </div>
  );
};
