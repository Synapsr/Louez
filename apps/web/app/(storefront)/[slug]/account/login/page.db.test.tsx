import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { isValidElement, type ReactElement } from "react";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The login page reached from the checkout's paid page asks for the sign-in of
// the customer the reservation belongs to (`owner=1`). A visitor already signed
// in as that customer goes straight to the reservation; one signed in as
// another customer of the store (a shared computer, a family member) is shown
// the code form instead of a reservation they cannot open, and is signed out
// of nothing. Without `owner=1`, a signed-in visitor is sent on as before. The
// session is read from the browser's cookie, on a database.

const directory = mkdtempSync(join(tmpdir(), "louez-login-owner-"));
after(() => rmSync(directory, { recursive: true }));

const STUBS_KEY = "__louezLoginOwnerStubs";
const STUBBED: Record<string, string> = {
  "next/headers": "headers",
  "next-intl/server": "intl",
  "./login-form": "loginForm",
  "@/components/storefront/page-tracker": "pageTracker",
};
for (const name of Object.values(STUBBED)) {
  writeFileSync(
    join(directory, `${name}.cjs`),
    `module.exports = globalThis.${STUBS_KEY}.${name};`,
  );
}

/** The browser's cookies, as `next/headers` reads them. */
const jar = new Map<string, string>();
const LoginForm = () => null;
Reflect.set(globalThis, STUBS_KEY, {
  headers: {
    cookies: async () => ({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    }),
  },
  intl: { getTranslations: async () => (key: string) => key },
  loginForm: { LoginForm },
  pageTracker: { PageTracker: () => null },
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    const stub = STUBBED[specifier];
    const stubbedHere =
      specifier === "next/headers"
        ? parent.endsWith("/lib/customer-auth/session.ts")
        : parent.endsWith("/account/login/page.tsx");
    if (stub && stubbedHere) {
      return { url: pathToFileURL(join(directory, `${stub}.cjs`)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_login_owner";
const SLUG = "login-owner";
const OWNER = "cust_login_owner";
const OTHER = "cust_login_other";
const RESERVATION = "res_login_owner";
const RESERVATION_PATH = `/account/reservations/${RESERVATION}?event=paid`;
const REDIRECT_DIGEST = /^NEXT_REDIRECT;/;

describe(
  "the login page asked for the reservation's own customer (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let page: typeof import("./page");

    const signIn = (customerId: string | null) => {
      jar.clear();
      if (customerId) jar.set("customer_session", `token_${customerId}`);
    };

    /** The page's answer: where it sends the visitor, or the form it shows. */
    const visit = async (query: Record<string, string>) => {
      try {
        const element = await page.default({
          params: Promise.resolve({ slug: SLUG }),
          searchParams: Promise.resolve(query),
        });
        return { redirectedTo: null, element };
      } catch (error) {
        const digest = (error as { digest?: unknown }).digest;
        if (typeof digest !== "string" || !REDIRECT_DIGEST.test(digest)) throw error;
        return { redirectedTo: digest.split(";")[2] ?? "", element: null };
      }
    };

    /** The login form in the page's tree, with the props it was given. */
    const findForm = (node: unknown): ReactElement<{ redirectPath: string }> | null => {
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = findForm(child);
          if (found) return found;
        }
        return null;
      }
      if (!isValidElement<{ children?: unknown; redirectPath: string }>(node)) return null;
      if (node.type === LoginForm) return node;
      return findForm(node.props.children);
    };

    before(async () => {
      database = await createTestDatabase("login_owner_only");
      louezDb = await import("@louez/db");
      page = await import("./page");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_login_owner",
        name: "Login",
        slug: SLUG,
        onboardingCompleted: true,
        settings: { reservationMode: "payment", currency: "EUR", advanceNoticeMinutes: 0 },
      });
      for (const id of [OWNER, OTHER]) {
        await louezDb.db.insert(louezDb.customers).values({
          id,
          storeId: STORE,
          email: `${id}@example.test`,
          firstName: "Renter",
          lastName: id,
        });
        await louezDb.db.insert(louezDb.customerSessions).values({
          id: `session_${id}`.slice(0, 21),
          customerId: id,
          token: `token_${id}`,
          // The latest a MySQL timestamp holds: the session stays valid for every run.
          expiresAt: new Date("2037-12-31T00:00:00Z"),
        });
      }
      await louezDb.db.insert(louezDb.reservations).values({
        id: RESERVATION,
        storeId: STORE,
        customerId: OWNER,
        number: "LOGIN-1",
        status: "confirmed",
        startDate: new Date("2031-06-10T09:00:00Z"),
        endDate: new Date("2031-06-12T09:00:00Z"),
        subtotalAmount: "120.00",
        depositAmount: "0.00",
        totalAmount: "120.00",
        currency: "EUR",
      });
    });

    beforeEach(() => jar.clear());

    after(async () => {
      Reflect.deleteProperty(globalThis, STUBS_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    test("signed in as the reservation's customer, the visitor goes to the reservation", async () => {
      signIn(OWNER);
      const answer = await visit({ redirect: RESERVATION_PATH, owner: "1" });
      assert.ok(answer.redirectedTo?.endsWith(RESERVATION_PATH), answer.redirectedTo ?? "");
    });

    test("signed in as another customer, the visitor is shown the code form for this reservation", async () => {
      signIn(OTHER);
      const answer = await visit({ redirect: RESERVATION_PATH, owner: "1" });

      assert.equal(answer.redirectedTo, null);
      assert.equal(findForm(answer.element)?.props.redirectPath, RESERVATION_PATH);
      assert.equal(jar.get("customer_session"), `token_${OTHER}`, "no one is signed out");
    });

    test("without the owner-only ask, a signed-in visitor is sent on as before", async () => {
      signIn(OTHER);
      const answer = await visit({ redirect: RESERVATION_PATH });
      assert.ok(answer.redirectedTo?.endsWith(RESERVATION_PATH), answer.redirectedTo ?? "");
    });

    test("the owner-only ask for a page that is not a reservation sends a signed-in visitor on", async () => {
      signIn(OTHER);
      const answer = await visit({ redirect: "/account", owner: "1" });
      assert.ok(answer.redirectedTo?.endsWith("/account"), answer.redirectedTo ?? "");
    });

    test("a visitor signed in as no one is shown the form", async () => {
      signIn(null);
      const answer = await visit({ redirect: RESERVATION_PATH, owner: "1" });
      assert.equal(findForm(answer.element)?.props.redirectPath, RESERVATION_PATH);
    });
  },
);
