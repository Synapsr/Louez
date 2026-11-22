import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/** The one-click demo entry (lib/demo): its own messages only. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={{ demo: messages.demo }}>
      <div className="dashboard min-h-svh bg-background">{children}</div>
    </NextIntlClientProvider>
  );
}
