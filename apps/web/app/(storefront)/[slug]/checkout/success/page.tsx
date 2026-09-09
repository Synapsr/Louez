import { storefrontRedirect } from "@/lib/storefront-url";

interface CheckoutSuccessPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const instant = false;

/**
 * Former Stripe `success_url`. Sessions created before the switch still point
 * here: hand the same query to the return route, which completes the payment.
 */
const CheckoutSuccessPage = async ({ params, searchParams }: CheckoutSuccessPageProps) => {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) {
      search.set(key, first);
    }
  }

  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  storefrontRedirect(slug, `/checkout/return${suffix}`);
};

export default CheckoutSuccessPage;
