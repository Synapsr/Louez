import { redirect } from "next/navigation";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** The contact page is edited in the online store editor. */
export default function ContactSettingsPage() {
  redirect("/online-store/contact");
}
