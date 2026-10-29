import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { BillingReturnToastSlot } from "@/components/dashboard/billing-return-toast-slot";
import { SwRegister } from "@/components/dashboard/sw-register";
import { FromHelloProvider } from "@/components/fromhello-provider";
import { GleapProvider } from "@/components/dashboard/gleap-provider";
import { OpenReplayProvider } from "@/components/openreplay-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";

import { createLoginUrl, LOGIN_CALLBACK_PATH_HEADER } from "@/lib/utils/util.url";

import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";
import { getCurrentPlanSlug } from "@/lib/stripe/subscriptions";

export const DashboardLayoutContent = async ({ children }: { children: React.ReactNode }) => {
  const session = await auth();

  // Redirect to login if not authenticated
  if (!session?.user) {
    const callbackUrl = (await headers()).get(LOGIN_CALLBACK_PATH_HEADER);
    redirect(createLoginUrl(callbackUrl));
  }

  const store = await getCurrentStore();
  const planSlug = store ? await getCurrentPlanSlug(store.id) : null;
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider
        user={
          session.user?.id && session.user?.email
            ? {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
              }
            : undefined
        }
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <OpenReplayProvider
            surface="dashboard"
            user={
              session.user?.id && session.user?.email
                ? {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                  }
                : undefined
            }
            store={
              store
                ? {
                    id: store.id,
                    name: store.name,
                  }
                : undefined
            }
          >
            <FromHelloProvider
              user={
                session.user?.id && session.user?.email
                  ? {
                      id: session.user.id,
                      email: session.user.email,
                      name: session.user.name,
                    }
                  : undefined
              }
              store={
                store
                  ? {
                      name: store.name,
                      slug: store.slug,
                      phone: store.phone,
                      email: store.email,
                      plan: planSlug,
                    }
                  : undefined
              }
            />
            <GleapProvider
              user={
                session.user?.id && session.user?.email
                  ? {
                      id: session.user.id,
                      email: session.user.email,
                      name: session.user.name,
                    }
                  : undefined
              }
              store={
                store
                  ? {
                      id: store.id,
                      name: store.name,
                    }
                  : undefined
              }
            >
              <div className="bg-background min-h-screen">{children}</div>
              <SwRegister />
              {/* The return from Stripe Checkout lands in the settings or the onboarding. */}
              <BillingReturnToastSlot />
            </GleapProvider>
          </OpenReplayProvider>
        </ThemeProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
};
