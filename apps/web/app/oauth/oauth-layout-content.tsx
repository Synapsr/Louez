import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { Logo } from "@louez/ui";

export const OAuthLayoutContent = async ({ children }: { children: React.ReactNode }) => {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-lg space-y-6">
          <Logo className="text-foreground" />
          {children}
        </div>
      </div>
    </NextIntlClientProvider>
  );
};
