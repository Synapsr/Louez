import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isBillingEnabled } from "@/lib/billing/mode";
import { selectAuthMessages } from "@/lib/i18n/auth-messages";
import { LagonThemeRoot } from "@/components/dashboard/lagon-theme-root";
import { PostHogProvider } from "@/components/posthog-provider";

export const AuthLayoutContent = async ({ children }: { children: React.ReactNode }) => {
  const session = await auth();

  // Redirect to dashboard if already authenticated
  if (session?.user) {
    redirect("/dashboard");
  }

  const messages = selectAuthMessages(await getMessages(), isBillingEnabled());

  return (
    <PostHogProvider>
      <NextIntlClientProvider messages={messages}>
        {/* Signing in is the door of the back office: it already wears Lagon. */}
        <LagonThemeRoot />
        <div className="dashboard theme-lagon min-h-screen bg-background">{children}</div>
      </NextIntlClientProvider>
    </PostHogProvider>
  );
};
