import type { OpenAPI } from "@orpc/contract";

/** A group of the REST reference, and the route prefixes of its operations. */
interface ReferenceGroup {
  name: string;
  description: string;
  /** Route prefixes, by whole segments; `{}` stands for one path parameter. */
  prefixes: readonly string[];
}

/**
 * The groups of the REST reference, in the order its menu shows them: one per
 * kind of record, each with a sentence that says what it holds. An operation
 * belongs to the group whose prefix matches the most segments of its route.
 */
export const REFERENCE_GROUPS: readonly ReferenceGroup[] = [
  {
    name: "Reservations",
    description:
      "Rental requests, quotes and bookings, from the request to the return: list and read them, follow the calendar, the planning and what is due or late, change their status, cancel them and keep notes on them.",
    prefixes: ["/reservations"],
  },
  {
    name: "Payments",
    description:
      "The payments and deposit returns recorded on a reservation: record one, or delete one recorded by mistake.",
    prefixes: ["/reservations/{}/payments", "/reservations/{}/deposit-returns", "/payments"],
  },
  {
    name: "Inbox",
    description:
      "What needs the store's attention, such as booking requests to answer, late returns, failed payments or messages that did not go out: read what is new since a cursor, and mark items handled.",
    prefixes: ["/inbox"],
  },
  {
    name: "Products",
    description:
      "What the store rents: its products, their prices, photos and status, their order, and what happened to each.",
    prefixes: ["/products"],
  },
  {
    name: "Units",
    description:
      "The tracked items of a product, each with its own identifier: their details and history, downtime for repair or maintenance, and retiring a unit for good.",
    prefixes: ["/products/{}/units", "/products/units", "/products/downtimes"],
  },
  {
    name: "Seasonal pricing",
    description: "Prices that replace a product's own rates on the days of a season.",
    prefixes: ["/products/{}/seasonal-pricings", "/products/seasonal-pricings"],
  },
  {
    name: "Variants",
    description:
      "The options products come in, such as size or colour, shared by the store's products, and their values.",
    prefixes: ["/variants"],
  },
  {
    name: "Categories",
    description: "How the store groups its products, with their images and their order.",
    prefixes: ["/categories"],
  },
  {
    name: "Search",
    description:
      "One search across the store's products, reservations and customers, as the dashboard's search bar does.",
    prefixes: ["/search"],
  },
  {
    name: "Statistics",
    description:
      "The store's figures: its dashboard's, its revenue over a period, and how each product performs.",
    prefixes: ["/analytics"],
  },
  {
    name: "Online store",
    description: "The store's public site: its address, its appearance and its images.",
    prefixes: ["/online-store"],
  },
  {
    name: "Settings",
    description:
      "How the store runs: its information, company and legal details, legal texts, reservation rules, business hours, delivery, pickup points and taxes.",
    prefixes: ["/settings"],
  },
  {
    name: "Stores",
    description:
      "The stores within reach, a new one, and the launch of a store: what it still lacks before customers can book, and putting it online.",
    prefixes: ["/stores"],
  },
  {
    name: "Stripe",
    description:
      "The store's Stripe account, through which customers pay online: connect it, open its Stripe dashboard and refresh its status.",
    prefixes: ["/payments/stripe"],
  },
  {
    name: "Billing",
    description: "What Louez bills the store, and the card Louez bills.",
    prefixes: ["/billing"],
  },
  {
    name: "Team",
    description: "The people who work in the store, and the invitations to join it.",
    prefixes: ["/team"],
  },
  {
    name: "Account",
    description: "The Louez account the API key acts for.",
    prefixes: ["/account"],
  },
  {
    name: "Jobs",
    description:
      "Work Louez runs in the background, such as an AI photo enhancement: where it stands, and its result.",
    prefixes: ["/jobs"],
  },
  {
    name: "Handoffs",
    description:
      "Steps only a person can take in their browser, such as Stripe's identity checks or adding a billing card: the operation that starts one returns a link, and these say where the step stands.",
    prefixes: ["/handoffs"],
  },
];

/** The document's `tags`: the groups, in order, with their sentence. */
export const REFERENCE_TAGS: OpenAPI.TagObject[] = REFERENCE_GROUPS.map(
  ({ name, description }) => ({ name, description }),
);

const segmentsOf = (path: string) => path.split("/").filter(Boolean);
const isParameter = (segment: string) => /^\{[^}]*\}$/.test(segment);

/**
 * The group of the operation at `routePath` (such as
 * `/products/units/{unitId}/retire`): the one whose prefix matches the most
 * of its segments, a `{}` of the prefix matching one path parameter. Undefined
 * when none matches.
 */
export function referenceGroupOf(routePath: string): string | undefined {
  const route = segmentsOf(routePath);
  let best: { name: string; length: number } | undefined;
  for (const { name, prefixes } of REFERENCE_GROUPS) {
    for (const prefix of prefixes) {
      const segments = segmentsOf(prefix);
      const matches =
        segments.length <= route.length &&
        segments.every((segment, index) =>
          segment === "{}" ? isParameter(route[index]) : segment === route[index],
        );
      if (matches && (!best || segments.length > best.length)) {
        best = { name, length: segments.length };
      }
    }
  }
  return best?.name;
}
