import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface ProductBreadcrumbProps {
  productName: string;
  category: { id: string; name: string } | null;
  className?: string;
}

/** Home / Catalogue / Catégorie / Produit — the crawlable path above the page. */
export const ProductBreadcrumb = ({ productName, category, className }: ProductBreadcrumbProps) => {
  const t = useTranslations("storefront.product.breadcrumb");
  const links = [
    { href: "/", label: t("home") },
    { href: "/catalog", label: t("catalog") },
    ...(category ? [{ href: `/catalog?category=${category.id}`, label: category.name }] : []),
  ];

  return (
    <nav aria-label={t("label")} className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-x-2 whitespace-nowrap text-sm text-muted-foreground">
        {links.map((link) => (
          <li key={link.href} className="contents">
            <StorefrontLink
              href={link.href}
              className="block min-h-8 max-w-[25%] shrink-0 truncate leading-8 transition-colors hover:text-foreground"
            >
              {link.label}
            </StorefrontLink>
            <span aria-hidden className="shrink-0">
              /
            </span>
          </li>
        ))}
        <li
          aria-current="page"
          className="min-h-8 min-w-0 flex-1 truncate leading-8 font-medium text-foreground"
        >
          {productName}
        </li>
      </ol>
    </nav>
  );
};
