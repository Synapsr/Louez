import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isBillingEnabled } from "@/lib/billing/mode";
import { selectAuthMessages } from "@/lib/i18n/auth-messages";
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
        <div className="dashboard min-h-screen bg-background">{children}</div>
      </NextIntlClientProvider>
    </PostHogProvider>
  );
};
