import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { canRemovePassword } from "@louez/auth/password";

import { auth } from "@/lib/auth";

import { PasswordAlertCard } from "./password-alert-card";

// Reads the session: request-bound, like every page behind the dashboard gate.
export const instant = false;

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("dashboard.settings.accountSettings.passwordAlert");
  return { title: t("title") };
};

/**
 * Landing page of the "This wasn't me" link of the password notice e-mail.
 * It sits in its own route group so it inherits the dashboard's sign-in gate
 * (an anonymous visitor is sent to /login and brought back here) without the
 * store-bound dashboard chrome: securing an account must not depend on having
 * finished onboarding.
 */
const PasswordAlertPage = async () => {
  const session = await auth();
  if (!session?.user.id) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-12">
      <PasswordAlertCard email={session.user.email} available={canRemovePassword()} />
    </main>
  );
};

export default PasswordAlertPage;
