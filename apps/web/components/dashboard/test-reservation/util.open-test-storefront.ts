import { orpcClient } from "@/lib/orpc/client";

/**
 * Starts a test reservation (testReservations.start): opens the storefront in
 * test mode in a new tab, or answers the store's test reservation still
 * running. The tab opens at the click, before the call, so the browser does
 * not block it as a pop-up; it closes again when there is nothing to open.
 */
export async function openTestStorefront(): Promise<{ existing: string } | { opened: true }> {
  const tab = window.open("", "_blank");
  try {
    const result = await orpcClient.dashboard.testReservations.start({});
    if ("url" in result) {
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else {
        window.location.assign(result.url);
      }
      return { opened: true };
    }
    tab?.close();
    return result;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
