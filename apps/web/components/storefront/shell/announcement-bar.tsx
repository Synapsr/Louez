import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import type { StoreAnnouncementLine } from "@/lib/utils/util.store-announcement";

interface AnnouncementBarProps {
  announcement: StoreAnnouncementLine;
}

const LINK_CLASS_NAME = "text-primary-foreground underline-offset-4 hover:underline";

/**
 * One centred line above the header in the store's colour: a closure, a
 * promo code, an event. Linked when the store gave it an href; another
 * site opens in a new tab, a store page navigates in place.
 */
export const AnnouncementBar = ({
  announcement: { text, href, external },
}: AnnouncementBarProps) => (
  <div
    data-slot="announcement-bar"
    className="bg-primary px-4 py-2 text-center text-sm text-balance text-primary-foreground"
  >
    {href === null ? (
      <p>{text}</p>
    ) : external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS_NAME}>
        {text}
      </a>
    ) : (
      <StorefrontLink href={href} className={LINK_CLASS_NAME}>
        {text}
      </StorefrontLink>
    )}
  </div>
);
