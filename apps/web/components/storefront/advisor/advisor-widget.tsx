'use client';

import { useAdvisor, useAdvisorRuntime } from '@/contexts/advisor-context';

import { AdvisorLauncher } from './advisor-launcher';
import { AdvisorPanel } from './advisor-panel';

/**
 * Floating advisor surface (launcher + panel). The chat runtime lives in
 * AdvisorProvider, so this is a thin view — and it stands aside entirely while
 * an inline surface (the checkout verification panel) is mounted, so exactly
 * one chat surface is ever visible.
 */
export const AdvisorWidget = () => {
  const { isOpen, open, close, intent, clearIntent, inlineActive } =
    useAdvisor();
  const {
    messages,
    isLoading,
    hasError,
    errorCode,
    send,
    restart,
    displayName,
    welcomeMessage,
  } = useAdvisorRuntime();

  if (inlineActive) return null;

  return (
    <>
      <AdvisorLauncher isOpen={isOpen} onClick={() => open()} />
      <AdvisorPanel
        isOpen={isOpen}
        onClose={close}
        displayName={displayName}
        welcomeMessage={welcomeMessage}
        intent={intent}
        onIntentConsumed={clearIntent}
        messages={messages}
        isLoading={isLoading}
        hasError={hasError}
        errorCode={errorCode}
        onSend={send}
        onRestart={restart}
      />
    </>
  );
};
