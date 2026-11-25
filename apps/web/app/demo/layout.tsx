import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/**
 * The one-click demo entry (lib/demo): its own messages only, the launcher's
 * progress, and the fade of the page once the store is ready (`data-demo-ready`,
 * set by the page's start script just before it leaves for the dashboard).
 */
const DEMO_ENTRY_CSS = `@keyframes demo-progress{0%{width:0}30%{width:55%}100%{width:92%}}
[data-demo-entry]{transition:opacity .12s ease-out}
[data-demo-ready] [data-demo-entry]{opacity:0}`;

export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={{ demo: messages.demo }}>
      <style href="demo-entry" precedence="default">
        {DEMO_ENTRY_CSS}
      </style>
      <div data-demo-entry className="dashboard min-h-svh bg-background">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
