import { apiHandoffs, db, storeMembers, stores } from "@louez/db";
import { and, eq } from "drizzle-orm";

import type { AgentClient } from "../contracts/agent-connections";
import { plainText, type HandoffDecision } from "../contracts/handoffs";
import { isConsequence, type Consequence } from "../platform/approval-rule";
import { databaseNow } from "../platform/database-clock";
import { grantClient } from "./agent-grants";
import { approvalPayloadOf, connectionAlive, mayActOnStep, statusOf } from "./handoffs";

/**
 * What the page of an operation's approval (`/handoffs/<id>`) and its result
 * (`/handoffs/done/<id>`) show their approver, read from the approval's row
 * and nothing else: the preview Louez stored when the agent last asked,
 * computed under the write's locks (docs/architecture/api-and-agents.md, "The
 * approval page"). Reading changes nothing. No procedure runs: a store that
 * moved since that preview is caught when the agent carries the approval
 * out, which computes the binding again under the write's locks and refuses
 * another one (`state_changed`).
 *
 * Whose step it is comes first, then whether the user may still decide it
 * (`mayActOnStep`): anyone else learns nothing of the request. An approval
 * whose connection no longer exists is inert whatever its row says: it reads
 * as ended (`connection_revoked`), never as decidable.
 */

type HandoffRow = typeof apiHandoffs.$inferSelect;

/**
 * Where an approval stands for its page. `pending` alone is decided there;
 * `unreadable` is a pending approval whose stored preview Louez cannot show
 * whole (no sentence, or one too long to show: `ShownPreview.truncated`),
 * which nobody may approve without reading it.
 */
export type ApprovalPageState =
  | "pending"
  | "unreadable"
  /** Approved, waiting for the agent to carry it out within its hour. */
  | "approved"
  /** Carried out. */
  | "completed"
  /** Approved, and its hour passed before the agent carried it out. */
  | "approved_expired"
  | "refused"
  /** The agent's call found the store, or the call, no longer as approved. */
  | "state_changed"
  /** The agent's call found the person who approved no longer allowed. */
  | "approver_not_allowed"
  | "connection_revoked"
  /** Nobody decided within its day. */
  | "expired"
  /** Ended for a reason this page does not name. */
  | "ended";

/** A value of the preview's details, as text a page shows. */
export type ShownValue =
  | { kind: "text"; text: string }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "none" }
  | { kind: "list"; entries: ShownDetail[] };

/** One line of the preview's details; an empty label for a value with no name. */
export interface ShownDetail {
  label: string;
  value: ShownValue;
}

export interface ShownPreview {
  /** One line, at most `SUMMARY_MAX` characters, an ellipsis last when it was cut. */
  summary: string;
  /** The stored summary was longer than `SUMMARY_MAX`: the page cannot show it whole. */
  truncated: boolean;
  details: ShownDetail[];
}

/** Who asks: an assistant connected over OAuth, or an API key, by the name it had when it asked. */
export type ApprovalAgent =
  | { kind: "oauth"; name: string | null; client: AgentClient | null }
  | { kind: "api_key"; name: string | null };

export interface ApprovalPage {
  id: string;
  state: ApprovalPageState;
  /** The revision and the binding the page shows: what a decision posts. Only while it is decidable. */
  revision: number;
  binding: string | null;
  store: { id: string; name: string };
  agent: ApprovalAgent;
  /** The preview Louez stored, as text; null when it cannot be shown. */
  preview: ShownPreview | null;
  /** What the action does, as the procedure declared it; the ones Louez does not know are left out. */
  consequences: Consequence[];
  /** Whether approving it asks for a deliberate step: anything but a plain change, or nothing known. */
  deliberate: boolean;
  /** When Louez computed the preview: the agent's last request. */
  computedAt: Date;
  /** Until when it may be decided, or once approved, carried out. */
  expiresAt: Date;
  /** The database's clock, which every time above is read against. */
  now: Date;
  completedAt: Date | null;
  decision: HandoffDecision;
}

export type ApprovalPageRead =
  | { ok: true; approval: ApprovalPage }
  /** No such approval; another account's; or a user who may not decide it now: nothing about it. */
  | { ok: false; reason: "invalid" | "other_user" | "not_allowed" };

const APPROVAL_ID = /^[A-Za-z0-9_-]{21}$/;

/** The consequences that are not a plain change the store can put back. */
const ASK_TO_TICK: ReadonlySet<Consequence> = new Set([
  "money",
  "stock_override",
  "access_removed",
  "deletion",
  "customer_message",
  "credits",
]);

export async function readApprovalPage(id: string, userId: string): Promise<ApprovalPageRead> {
  if (!APPROVAL_ID.test(id)) return { ok: false, reason: "invalid" };
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  if (!row || row.kind !== "operation_approval") return { ok: false, reason: "invalid" };
  if (row.userId !== userId) return { ok: false, reason: "other_user" };
  const [member] = await db
    .select({ role: storeMembers.role, storeName: stores.name })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.storeId, row.storeId), eq(storeMembers.userId, userId)));
  const payload = approvalPayloadOf(row);
  if (!member || !payload || !mayActOnStep(row, userId, member.role)) {
    return { ok: false, reason: "not_allowed" };
  }

  const now = await databaseNow();
  const alive = await connectionAlive(row);
  const preview = shownPreview(payload.preview);
  const consequences = knownConsequences(payload.consequences);
  const state = pageState(row, now, alive, preview !== null && !preview.truncated);
  return {
    ok: true,
    approval: {
      id: row.id,
      state,
      revision: row.revision,
      binding: state === "pending" ? row.bindingHash : null,
      store: { id: row.storeId, name: member.storeName },
      agent: await agentOf(row),
      preview,
      consequences,
      deliberate: asksToTick(consequences),
      computedAt: row.linkIssuedAt,
      expiresAt: row.expiresAt,
      now,
      completedAt: row.completedAt,
      decision:
        row.decision && row.decidedAt
          ? { outcome: row.decision, at: row.decidedAt, reason: row.decisionReason }
          : null,
    },
  };
}

/** Where the row stands for its page, at `now` on the database's clock. */
function pageState(
  row: HandoffRow,
  now: Date,
  connectionExists: boolean,
  readable: boolean,
): ApprovalPageState {
  const status = statusOf(row, now);
  // Inert once its connection is gone: nobody decides it, nobody carries it out.
  if (!connectionExists && (status === "pending" || status === "approved")) {
    return "connection_revoked";
  }
  switch (status) {
    case "pending":
    case "opened":
      return readable && row.bindingHash ? "pending" : "unreadable";
    case "approved":
      return "approved";
    case "completed":
      return "completed";
    case "expired":
      return row.status === "approved" ? "approved_expired" : "expired";
    case "failed":
      switch (row.failureCode) {
        case "declined":
          return "refused";
        case "state_changed":
        case "approver_not_allowed":
        case "connection_revoked":
          return row.failureCode;
        default:
          return "ended";
      }
  }
}

async function agentOf(row: HandoffRow): Promise<ApprovalAgent> {
  const name = row.clientName ? oneLine(row.clientName) || null : null;
  if (row.credentialKind === "oauth" && row.credentialId) {
    return { kind: "oauth", name, client: await grantClient(row.userId, row.credentialId) };
  }
  return { kind: "api_key", name };
}

const knownConsequences = (stored: unknown): Consequence[] =>
  Array.isArray(stored) ? [...new Set(stored.filter(isConsequence))] : [];

/**
 * Whether approving asks the person to tick that they read what Louez will
 * do: anything but a plain change, or no consequence Louez knows.
 */
const asksToTick = (consequences: readonly Consequence[]) =>
  consequences.length === 0 || consequences.some((consequence) => ASK_TO_TICK.has(consequence));

/**
 * Whether an approval is approved only with the box ticked: the page shows
 * it (`deliberate`), and `handoffs.decide` refuses an approval of it that
 * did not post it (services/handoff-decisions.ts). False for another kind.
 */
export function approvalAsksToTick(row: Pick<HandoffRow, "kind" | "payload">): boolean {
  if (row.kind !== "operation_approval") return false;
  const payload = row.payload && "consequences" in row.payload ? row.payload : null;
  return asksToTick(knownConsequences(payload?.consequences));
}

/** The most of a summary the page shows, in characters, once on one line. */
export const SUMMARY_MAX = 1_000;

/**
 * Every run of white space: line breaks, tabs, the line and paragraph
 * separators, no-break and zero-width spaces, the word joiner.
 */
const WHITE_SPACE = /[\s\u180e\u200b\u2060\ufeff]+/gu;

/**
 * Text as one line of plain text (`plainText`): every run of white space one
 * space. Text from the store's records (a customer's name) then cannot draw
 * lines of its own inside what Louez says.
 */
export const oneLine = (raw: string) => plainText(raw).replace(WHITE_SPACE, " ").trim();

/**
 * The stored preview as text, whatever it holds: its summary on one line,
 * cut at `SUMMARY_MAX` characters with an ellipsis (`truncated`), and its
 * details, each string on one line (`oneLine`), numbers written as
 * JavaScript writes them, the names of the details spelled out
 * ("reservationId" reads "Reservation id"). The details come in the order
 * the database keeps a JSON object's keys (MySQL sorts them by length), not
 * the order the procedure wrote them. Null when it has no summary to show:
 * an approval whose preview cannot be read whole is not approved on its page.
 */
export function shownPreview(stored: unknown): ShownPreview | null {
  if (!isRecord(stored)) return null;
  const { summary, details } = stored;
  if (typeof summary !== "string") return null;
  const characters = [...oneLine(summary)];
  if (characters.length === 0) return null;
  const truncated = characters.length > SUMMARY_MAX;
  const text = truncated
    ? `${characters.slice(0, SUMMARY_MAX - 1).join("").trimEnd()}…`
    : characters.join("");
  const shown = { summary: text, truncated };
  if (details === undefined || details === null) return { ...shown, details: [] };
  if (isRecord(details)) return { ...shown, details: entriesOf(details, 1) };
  return { ...shown, details: [{ label: "", value: shownValue(details, 1) }] };
}

/** Past four levels of lists, a value is shown as its JSON text. */
const MAX_DEPTH = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function entriesOf(record: Record<string, unknown>, depth: number): ShownDetail[] {
  return Object.entries(record).map(([key, value]) => ({
    label: labelOf(key),
    value: shownValue(value, depth + 1),
  }));
}

function shownValue(value: unknown, depth: number): ShownValue {
  if (value === null || value === undefined) return { kind: "none" };
  if (value === true) return { kind: "yes" };
  if (value === false) return { kind: "no" };
  if (typeof value === "string") return { kind: "text", text: oneLine(value) };
  if (typeof value === "number" || typeof value === "bigint") {
    return { kind: "text", text: String(value) };
  }
  if (depth > MAX_DEPTH) return { kind: "text", text: oneLine(JSON.stringify(value) ?? "") };
  if (Array.isArray(value)) {
    return {
      kind: "list",
      entries: value.map((entry, index) => ({
        label: String(index + 1),
        value: shownValue(entry, depth + 1),
      })),
    };
  }
  if (isRecord(value)) return { kind: "list", entries: entriesOf(value, depth) };
  return { kind: "text", text: oneLine(String(value)) };
}

/** A detail's name spelled out: "reservationId" and "reservation_id" read "Reservation id". */
function labelOf(key: string): string {
  const words = oneLine(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
