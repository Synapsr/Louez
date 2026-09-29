import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { PostHogProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";

import { auth } from "@/lib/auth";
import { isStandaloneMode } from "@/lib/deployment";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getUserStores } from "@/lib/store-context";
import { createLoginUrl, LOGIN_CALLBACK_PATH_HEADER } from "@/lib/utils/util.url";

import { MultiStoreHeader } from "./_components/header";
import { MultiStoreLayoutView } from "./multi-store-layout-view";

export const MultiStoreLayoutContent = async ({ children }: { children: React.ReactNode }) => {
  // Standalone instances host a single store — the aggregated view has no
  // reason to exist there, regardless of how many stores the data holds.
  if (isStandaloneMode()) {
    redirect("/dashboard");
  }

  const session = await auth();

  if (!session?.user?.id) {
    const callbackUrl = (await headers()).get(LOGIN_CALLBACK_PATH_HEADER);
    redirect(createLoginUrl(callbackUrl));
  }

  const stores = await getUserStores();

  if (stores.length < 2) {
    redirect("/dashboard");
  }

  const isPlatformAdmin = await isCurrentUserPlatformAdmin();
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider
        user={{
          id: session.user.id,
          email: session.user.email || "",
          name: session.user.name,
        }}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MultiStoreLayoutView
            header={
              <MultiStoreHeader
                stores={stores}
                userEmail={session.user.email || ""}
                userImage={session.user.image}
                isPlatformAdmin={isPlatformAdmin}
              />
            }
          >
            {children}
          </MultiStoreLayoutView>
        </ThemeProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
};
