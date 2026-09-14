import { redirect } from "next/navigation";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Search engine settings are edited in the online store editor. */
export default function SeoSettingsPage() {
  redirect("/online-store/seo");
}
