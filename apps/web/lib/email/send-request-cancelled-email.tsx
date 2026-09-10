import { render } from "@react-email/render";
import { getTranslations } from "next-intl/server";

import { sendEmail } from "@/lib/email/client";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { logEmail } from "@/lib/email/send";
import { BaseLayout } from "@/lib/email/templates/base-layout";
import { EmailHeading, EmailText } from "@/lib/email/templates/components";

export const sendRequestCancelledEmail = async ({
  store,
  reservation,
  customer,
}: {
  store: { id: string; name: string; email: string; settings: { country?: string } | null };
  reservation: { id: string; number: string };
  customer: { firstName: string; lastName: string };
}): Promise<void> => {
  const locale = getLocaleFromCountry(store.settings?.country);
  const t = await getTranslations({ locale, namespace: "storefront.account.cancellation" });
  const subject = t("adminSubject", { number: reservation.number });
  const html = await render(
    <BaseLayout preview={subject} storeName={store.name} locale={locale}>
      <EmailHeading>{subject}</EmailHeading>
      <EmailText>
        {t("adminBody", {
          name: `${customer.firstName} ${customer.lastName}`,
          number: reservation.number,
        })}
      </EmailText>
    </BaseLayout>,
  );
  const context = {
    storeId: store.id,
    reservationId: reservation.id,
    to: store.email,
    subject,
    templateType: "request_cancelled_landlord",
  };
  try {
    const result = await sendEmail({ to: store.email, subject, html, fromName: store.name });
    await logEmail({ ...context, status: "sent", messageId: result.messageId });
  } catch (error) {
    await logEmail({ ...context, status: "failed", error: String(error) });
    throw error;
  }
};
