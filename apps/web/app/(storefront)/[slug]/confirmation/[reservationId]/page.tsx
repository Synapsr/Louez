import { storefrontRedirect } from "@/lib/storefront-url";

interface ConfirmationPageProps {
  params: Promise<{ slug: string; reservationId: string }>;
}

export const instant = false;

/**
 * Former request-mode landing. The reservation page is the one destination
 * after a reservation; old links and bookmarks follow it there.
 */
const ConfirmationPage = async ({ params }: ConfirmationPageProps) => {
  const { slug, reservationId } = await params;
  storefrontRedirect(slug, `/account/reservations/${encodeURIComponent(reservationId)}`);
};

export default ConfirmationPage;
