import * as nodeModule from "node:module";

// What the dashboard's reservation actions need to run in a test, outside a
// Next.js request: the store of the session, the page cache, and the messages
// to the customer, which are noted and never sent. Import this file before
// `./actions` is loaded.

interface ResolveContext {
  parentURL?: string;
}
interface LoadContext {
  format?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };
type NextLoad = (url: string, context: LoadContext) => { format?: string; source?: unknown };

/** Where a suite puts what `getCurrentStore` returns. */
export const STORE_KEY = "__louezActionsTestStore";
/** Where the stubbed emails and SMS note their calls, once a suite sets an array there. */
export const SENT_KEY = "__louezActionsTestSent";
/**
 * Where a suite sets how the stubbed services answer: `emailConfigured` (true
 * by default), and a sender's answer by its name (`{ success: true }` by default).
 */
export const OUTCOME_KEY = "__louezActionsTestOutcome";
/** A module whose functions note their call (channel, name, params) and answer as the suite set. */
const messageStub = (channel: string, names: string[]) =>
  names
    .map(
      (name) =>
        `export async function ${name}(params) { (globalThis[${JSON.stringify(SENT_KEY)}] ??= []).push({ channel: ${JSON.stringify(channel)}, name: ${JSON.stringify(name)}, params }); return globalThis[${JSON.stringify(OUTCOME_KEY)}]?.[${JSON.stringify(name)}] ?? { success: true }; }\n`,
    )
    .join("");
const STUB_SCHEME = "louez-actions-test:";
// The request context of a server action, which a test has no Next.js runtime for.
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  // Whether this instance sends e-mail, as the suite set it.
  "@louez/email": `export function isEmailConfigured() { return globalThis[${JSON.stringify(OUTCOME_KEY)}]?.emailConfigured ?? true; }\n`,
  "@/lib/auth": "export async function auth() { return null; }\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
  // A quote's email is sent without being awaited, and would outlive the database.
  "@/lib/notifications/customer-dispatcher":
    "export async function dispatchCustomerNotification() {}\n",
  // The messages to the customer: what they were asked to send, never sent.
  "@/lib/email/send": `${messageStub("email", [
    "logEmail",
    "sendDepositAuthorizationRequestEmail",
    "sendPaymentRequestEmail",
    "sendReservationConfirmationEmail",
    "sendReservationModifiedEmail",
  ])}export async function isEmailDelivered() { return false; }\n`,
  "@/lib/sms": `${messageStub("sms", [
    "sendAccessLinkSms",
    "sendDepositAuthorizationRequestSms",
    "sendPaymentRequestSms",
  ])}export function isSmsConfigured() { return true; }\n`,
};
const ACTIONS_FILE = "/dashboard/reservations/actions.ts";
/** The modification e-mail the actions send through, with no session (lib/reservations). */
const MODIFICATION_EMAIL_FILE = "/lib/reservations/modification-email.ts";
const FILES_SDK = new URL("../../../../node_modules/files-sdk/dist/", import.meta.url);

const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    // A module that imports "server-only" throws outside Next.
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    // files-sdk exports ESM only, through an "import" condition the test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { shortCircuit: true, url: new URL(entry, FILES_SDK).href };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith(ACTIONS_FILE) && specifier in STUBS) {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    if (parent.endsWith(MODIFICATION_EMAIL_FILE) && specifier === "@/lib/email/send") {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    return nextResolve(specifier, context);
  },
  load(url: string, context: LoadContext, nextLoad: NextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
      return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB_SCHEME.length)] };
    }
    return nextLoad(url, context);
  },
});
