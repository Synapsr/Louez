import { redirect } from "next/navigation";

import {
  ONLINE_STORE_DEFAULT_SECTION,
  getOnlineStoreSectionHref,
} from "@/components/online-store/online-store.constants";

/** The editor root has no page of its own: it opens on the first section. */
export default function OnlineStorePage() {
  redirect(getOnlineStoreSectionHref(ONLINE_STORE_DEFAULT_SECTION));
}
