import { apiHandoffs, db, storeMembers, stores } from "@louez/db";
import { and, eq } from "drizzle-orm";

import type { AgentClient } from "../contracts/agent-connections";
import type { HandoffDecision } from "../contracts/handoffs";
import type { Consequence } from "../platform/approval-rule";
import { databaseNow } from "../platform/database-clock";
import { grantClient } from "./agent-grants";
import {
  approvalAsksToTick,
  approvalIsReadable,
  knownConsequences,
  oneLine,
  shownPreview,
  type ShownPreview,
} from "./approval-preview";
import { approvalPayloadOf, connectionAlive, mayActOnStep, statusOf } from "./handoffs";

export {
  SUMMARY_MAX,
  oneLine,
  type ShownDetail,
  type ShownPreview,
  type ShownValue,
} from "./approval-preview";

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
 * whole (`approvalIsReadable`: no sentence, or one too long to show,
 * `ShownPreview.truncated`), which nobody may approve without reading it.
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

/**
 * Who asks: an assistant connected over OAuth, or an API key, by the name it
 * had when it asked. `shownName` is the name the page's always-visible line
 * gives it, on one line: a connected assistant's as the consent page names
 * it (its vendor's when its codes reach one vendor alone, else the name it
 * declared), an API key's own; null when it has none.
 */
export type ApprovalAgent =
  | { kind: "oauth"; name: string | null; client: AgentClient | null; shownName: string | null }
  | { kind: "api_key"; name: string | null; shownName: string | null };

export interface ApprovalPage {
  id: string;
  state: ApprovalPageState;
  /** The revision and the binding the page shows: what a decision posts. Only while it is decidable. */
  revision: number;
  binding: string | null;
  /**
   * The store, its name on one line, and the time zone its dates are written
   * in: the store's own (`settings.timezone`), else UTC, as the store's
   * figures are (services/analytics.ts).
   */
  store: { id: string; name: string; timeZone: string };
  agent: ApprovalAgent;
  /** The preview Louez stored, as text; null when it cannot be shown. */
  preview: ShownPreview | null;
  /** What the action does, as the procedure declared it; the ones Louez does not know are left out. */
  consequences: Consequence[];
  /** Whether approving it asks for the box (`approvalAsksToTick`, from the consequences as stored). */
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

/** Where a test holds a read of the page between its steps, to order a write between them. */
export interface ApprovalPageSeams {
  /** After the database's clock is read, before the row is. */
  afterClock?: () => Promise<void>;
  /** After the row is read, before its connection is. */
  afterRow?: () => Promise<void>;
}

/**
 * The page's read, in this order. The database's clock first, then the row:
 * whatever committed before the clock was read is in the row read after it,
 * so a request read as lapsed (`expired`, `approved_expired`) had not been
 * carried out, nor decided, when its time was judged. Then its connection:
 * found gone while the row read as pending or approved, the row is read
 * again, after the connection, and judged on that second read, so a call
 * that carried it out and committed before the connection was removed reads
 * `completed`, never `connection_revoked`.
 */
export async function readApprovalPage(
  id: string,
  userId: string,
  seams: ApprovalPageSeams = {},
): Promise<ApprovalPageRead> {
  if (!APPROVAL_ID.test(id)) return { ok: false, reason: "invalid" };
  const now = await databaseNow();
  await seams.afterClock?.();
  let row = await approvalRow(id);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.userId !== userId) return { ok: false, reason: "other_user" };
  const [member] = await db
    .select({ role: storeMembers.role, storeName: stores.name, settings: stores.settings })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.storeId, row.storeId), eq(storeMembers.userId, userId)));
  const payload = approvalPayloadOf(row);
  if (!member || !payload || !mayActOnStep(row, userId, member.role)) {
    return { ok: false, reason: "not_allowed" };
  }

  await seams.afterRow?.();
  const alive = await connectionAlive(row);
  const open = (candidate: HandoffRow) => {
    const status = statusOf(candidate, now);
    return status === "pending" || status === "approved";
  };
  if (!alive && open(row)) row = (await approvalRow(id)) ?? row;
  const stored = approvalPayloadOf(row) ?? payload;
  const preview = shownPreview(stored.preview);
  const state = pageState(row, now, alive, approvalIsReadable(stored));
  return {
    ok: true,
    approval: {
      id: row.id,
      state,
      revision: row.revision,
      binding: state === "pending" ? row.bindingHash : null,
      store: {
        id: row.storeId,
        name: oneLine(member.storeName),
        timeZone: timeZoneOf(member.settings?.timezone),
      },
      agent: await agentOf(row),
      preview,
      consequences: knownConsequences(stored.consequences),
      deliberate: approvalAsksToTick(stored.consequences),
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

async function approvalRow(id: string): Promise<HandoffRow | null> {
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  return row && row.kind === "operation_approval" ? row : null;
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
    const client = await grantClient(row.userId, row.credentialId);
    const declared = client?.destination?.name ?? client?.name ?? name;
    return { kind: "oauth", name, client, shownName: declared ? oneLine(declared) || null : null };
  }
  return { kind: "api_key", name, shownName: name };
}

/** The store's time zone when it names one the runtime knows, else UTC. */
function timeZoneOf(stored: unknown): string {
  if (typeof stored !== "string" || stored.trim() === "") return "UTC";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: stored.trim() }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
