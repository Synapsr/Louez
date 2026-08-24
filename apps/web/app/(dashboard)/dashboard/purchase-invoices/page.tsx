import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { getSuperPdpEnrollment } from "@/app/(dashboard)/dashboard/settings/invoicing/queries";
import { ElectronicInvoicingNotAvailable } from "@/components/dashboard/electronic-invoicing-not-available";
import { isElectronicInvoicingEnabled } from "@/lib/invoicing/feature";
import { getCurrentStore } from "@/lib/store-context";

import { getReceivedInvoicesPage } from "./queries";
import { PurchaseInvoicesEmptyState } from "./purchase-invoices-empty-state";
import { PurchaseInvoicesNotConnected } from "./purchase-invoices-not-connected";
import { PurchaseInvoicesPagination } from "./purchase-invoices-pagination";
import { PurchaseInvoicesTable } from "./purchase-invoices-table";
import { SyncPurchaseInvoicesButton } from "./sync-purchase-invoices-button";
import { isPdpReceptionActive, parsePurchaseInvoicesPage } from "./util.purchase-invoices";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

type PurchaseInvoicesPageProps = {
  searchParams: Promise<{ page?: string }>;
};

/** Inbox of the supplier invoices Super PDP delivered to this store. */
const PurchaseInvoicesPage = async ({ searchParams }: PurchaseInvoicesPageProps) => {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const [t, featureEnabled] = await Promise.all([
    getTranslations("dashboard.purchaseInvoices"),
    isElectronicInvoicingEnabled(store.id),
  ]);

  if (!featureEnabled) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <ElectronicInvoicingNotAvailable />
      </div>
    );
  }

  const [enrollment, params] = await Promise.all([getSuperPdpEnrollment(store.id), searchParams]);

  const isConnected = isPdpReceptionActive(enrollment);
  const invoicesPage = isConnected
    ? await getReceivedInvoicesPage({
        page: parsePurchaseInvoicesPage(params.page),
        storeId: store.id,
      })
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("description")}</p>
        </div>
        {isConnected && <SyncPurchaseInvoicesButton />}
      </div>

      {invoicesPage === null && <PurchaseInvoicesNotConnected />}

      {invoicesPage !== null && invoicesPage.totalCount === 0 && <PurchaseInvoicesEmptyState />}

      {invoicesPage !== null && invoicesPage.totalCount > 0 && (
        <>
          <PurchaseInvoicesTable invoices={invoicesPage.invoices} />
          <PurchaseInvoicesPagination
            page={invoicesPage.page}
            pageCount={invoicesPage.pageCount}
            totalCount={invoicesPage.totalCount}
          />
        </>
      )}
    </div>
  );
};

export default PurchaseInvoicesPage;
