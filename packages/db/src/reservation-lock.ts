import { and, asc, eq, inArray } from "drizzle-orm";

import type { Transaction } from "./index";
import { products, reservationItems, reservations } from "./schema";

/**
 * The locks of a reservation's status change, in the lock order of DL-12
 * (docs/code-review/04-data-layer.md): the reservation's products by id, then
 * the reservation. A lock is a token: `changeReservationStatus` and the stock
 * helpers refuse to run without one, so a status change cannot be written
 * without its locks. Only the owner entry (`runReservationTransaction` in
 * `reservation-change.ts`) opens a transaction that can take one.
 *
 * What a token allows is what this module recorded when it issued it: its
 * transaction, store, reservation and kind are read from the registry, never
 * from the token's own fields. An issued token is frozen, so its fields cannot
 * be changed either; they are there to be read.
 */

export interface ReservationScope {
  reservationId: string;
  storeId: string;
}

/**
 * - `products`: the reservation's products, then the reservation. Any status change.
 * - `reservation`: the reservation alone. Only a change that takes or gives
 *   back no stock and runs no check (`beforeWrite`).
 * - `inserted`: a reservation this transaction inserted (`insertReservation`).
 *   Its caller locked the products before the insert. It allows one thing,
 *   once: `consumeReservationStock` for that reservation, then it is spent.
 */
export type ReservationLockKind = "products" | "reservation" | "inserted";

/** A misuse of the lock tokens: a bug in the caller, never a condition to handle. */
export class ReservationLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationLockError";
  }
}

/**
 * The reservation got a product while its change waited for its lock (an edit
 * added a line): that product is not locked, and locking it now, behind the
 * reservation, would invert the lock order. The owner entry rolls back and
 * runs the whole transaction again.
 */
export class ReservationProductsChangedError extends Error {
  constructor(readonly reservationId: string) {
    super("The reservation's products changed while its change waited for it.");
    this.name = "ReservationProductsChangedError";
  }
}

/** Read by name too: a test or a bundle may load this module twice. */
export function isReservationProductsChangedError(
  error: unknown,
): error is ReservationProductsChangedError {
  return (
    error instanceof ReservationProductsChangedError ||
    (error instanceof Error && error.name === "ReservationProductsChangedError")
  );
}

interface OwnerState {
  tx: Transaction;
  open: boolean;
}

let createOwner: (tx: Transaction) => ReservationTransaction;
let createLock: <Kind extends ReservationLockKind>(
  kind: Kind,
  scope: ReservationScope,
) => ReservationLock<Kind>;

/** A transaction the owner entry opened. Nothing else can make one. */
export class ReservationTransaction {
  // A private member makes the type nominal: no object literal passes for one.
  declare private readonly ownerEntry: true;
  private constructor() {}
  static {
    createOwner = (tx) => {
      const owner = new ReservationTransaction();
      Object.freeze(owner);
      const state: OwnerState = { tx, open: true };
      registry().owners.set(owner, state);
      registry().ownerOfTransaction.set(tx, state);
      return owner;
    };
  }
}

/** Bound to its transaction, its store and its reservation. Nothing outside this module makes one. */
export class ReservationLock<Kind extends ReservationLockKind = ReservationLockKind> {
  // A private member makes the type nominal: no object literal passes for one.
  declare private readonly issued: true;
  private constructor(
    readonly kind: Kind,
    readonly reservationId: string,
    readonly storeId: string,
  ) {}
  static {
    createLock = (kind, scope) => {
      const lock = new ReservationLock(kind, scope.reservationId, scope.storeId);
      Object.freeze(lock);
      return lock;
    };
  }
}

export type ReservationProductsLock = ReservationLock<"products">;
export type ReservationOnlyLock = ReservationLock<"reservation">;
export type InsertedReservationLock = ReservationLock<"inserted">;
/** What a status change accepts. */
export type ReservationStatusLock = ReservationProductsLock | ReservationOnlyLock;
/** What taking consumable stock accepts. */
export type ReservationStockLock = ReservationProductsLock | InsertedReservationLock;

/** What a token was issued for: the only thing the checks read. */
interface IssuedLock {
  tx: Transaction;
  /** Null for an inserted token whose transaction the owner entry did not open. */
  owner: OwnerState | null;
  kind: ReservationLockKind;
  reservationId: string;
  storeId: string;
  /** An inserted token, once used. */
  spent: boolean;
}

interface Registry {
  owners: WeakMap<ReservationTransaction, OwnerState>;
  /** The owner of each transaction the owner entry opened. */
  ownerOfTransaction: WeakMap<Transaction, OwnerState>;
  locks: WeakMap<ReservationLock, IssuedLock>;
}

const REGISTRY = Symbol.for("louez.reservationLock.registry");

const isRegistry = (value: unknown): value is Registry =>
  typeof value === "object" &&
  value !== null &&
  "owners" in value &&
  "ownerOfTransaction" in value &&
  "locks" in value;

/**
 * What this module issued. On globalThis, so a token issued by one copy of the
 * module is known to another: the tests load packages/db through two module
 * systems. The registry guards against a caller's mistake, not against code
 * running in the process.
 */
function registry(): Registry {
  const existing: unknown = Reflect.get(globalThis, REGISTRY);
  if (isRegistry(existing)) return existing;
  const created: Registry = {
    owners: new WeakMap(),
    ownerOfTransaction: new WeakMap(),
    locks: new WeakMap(),
  };
  Reflect.set(globalThis, REGISTRY, created);
  return created;
}

/** For the owner entry only: not exported from the package. */
export function openReservationTransaction(tx: Transaction): ReservationTransaction {
  return createOwner(tx);
}

/** For the owner entry only: its tokens stop working once its transaction ends. */
export function closeReservationTransaction(owner: ReservationTransaction): void {
  const state = registry().owners.get(owner);
  if (state) state.open = false;
}

function ownerTransaction(owner: ReservationTransaction): OwnerState {
  const state = registry().owners.get(owner);
  if (!state) throw new ReservationLockError("Not a transaction the owner entry opened.");
  if (!state.open) throw new ReservationLockError("The owner entry's transaction has ended.");
  return state;
}

function issue<Kind extends ReservationLockKind>(
  kind: Kind,
  scope: ReservationScope,
  tx: Transaction,
  owner: OwnerState | null,
): ReservationLock<Kind> {
  const { reservationId, storeId } = scope;
  const lock = createLock(kind, { reservationId, storeId });
  registry().locks.set(lock, { tx, owner, kind, reservationId, storeId, spent: false });
  return lock;
}

/** The ids of the reservation's products, sorted. A plain read: the owner runs READ COMMITTED. */
async function reservationProductIds(tx: Transaction, scope: ReservationScope) {
  const lines = await tx
    .selectDistinct({ productId: reservationItems.productId })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        eq(reservationItems.reservationId, scope.reservationId),
        eq(reservations.storeId, scope.storeId),
      ),
    );
  return lines.flatMap((line) => (line.productId ? [line.productId] : [])).sort();
}

async function lockReservationRow(tx: Transaction, scope: ReservationScope) {
  await reservationChangeTestHooks().beforeReservationLock?.(scope);
  await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)))
    .for("update");
}

/**
 * Locks the reservation's products by id, then the reservation, then reads its
 * products again: one that joined meanwhile throws
 * `ReservationProductsChangedError`, which the owner entry answers by running
 * the whole transaction again. For an operation composed inside a transaction
 * the owner entry opened. A reservation that does not exist in the store
 * still gets its token: the status change then answers `not_found`.
 */
export async function lockReservationInTransaction(
  owner: ReservationTransaction,
  scope: ReservationScope,
): Promise<ReservationProductsLock> {
  const state = ownerTransaction(owner);
  const { tx } = state;
  const productIds = await reservationProductIds(tx, scope);
  if (productIds.length > 0) {
    await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.storeId, scope.storeId), inArray(products.id, productIds)))
      .orderBy(asc(products.id))
      .for("update");
  }
  await lockReservationRow(tx, scope);
  const current = await reservationProductIds(tx, scope);
  if (current.some((productId) => !productIds.includes(productId))) {
    throw new ReservationProductsChangedError(scope.reservationId);
  }
  return issue("products", scope, tx, state);
}

/**
 * Locks the reservation alone, for a change that moves no stock: a pending
 * checkout cancelled, a quote declined. A status change refuses this token
 * for a transition that takes or gives back stock, or that runs a check.
 */
export async function lockReservationOnlyInTransaction(
  owner: ReservationTransaction,
  scope: ReservationScope,
): Promise<ReservationOnlyLock> {
  const state = ownerTransaction(owner);
  await lockReservationRow(state.tx, scope);
  return issue("reservation", scope, state.tx, state);
}

/**
 * For `insertReservation` only: the row it inserted is this transaction's
 * alone until commit.
 *
 * In a transaction the owner entry opened (the checkout's), the token is bound
 * to that owner and stops working when its transaction ends, committed or
 * rolled back. In a transaction the owner entry did not open (the dashboard's
 * creation opens its own), nothing tells this module when it ends: the token
 * is valid for that transaction only by convention. Either way it is spent by
 * its single use, the stock taken right after the lines are inserted, so a
 * token kept past it allows nothing.
 */
export function insertedReservationLock(
  tx: Transaction,
  scope: ReservationScope,
): InsertedReservationLock {
  const owner = registry().ownerOfTransaction.get(tx) ?? null;
  return issue("inserted", scope, tx, owner);
}

/** What an accepted token was issued for, read from the registry. */
export interface ReservationLockGrant {
  kind: ReservationLockKind;
  reservationId: string;
  storeId: string;
}

/**
 * Throws unless `lock` was issued by this module, in `tx`, while its owner's
 * transaction is open, is of one of `kinds`, and, when `scope` is given, was
 * issued for that reservation of that store. Everything is read from what was
 * recorded at issue, never from the token. An inserted token is spent by the
 * first use it allows. Returns what the token was issued for.
 */
export function assertReservationLock(
  tx: Transaction,
  lock: ReservationLock,
  kinds: readonly ReservationLockKind[],
  scope?: ReservationScope,
): ReservationLockGrant {
  const issued = registry().locks.get(lock);
  if (!issued) throw new ReservationLockError("Not a reservation lock.");
  if (issued.tx !== tx) {
    throw new ReservationLockError("The reservation lock belongs to another transaction.");
  }
  if (issued.owner && !issued.owner.open) {
    throw new ReservationLockError("The reservation lock's transaction has ended.");
  }
  if (scope && (issued.reservationId !== scope.reservationId || issued.storeId !== scope.storeId)) {
    throw new ReservationLockError("The reservation lock is for another reservation.");
  }
  if (!kinds.includes(issued.kind)) {
    throw new ReservationLockError(
      `A ${issued.kind} lock does not allow this change: it needs ${kinds.join(" or ")}.`,
    );
  }
  if (issued.spent) {
    throw new ReservationLockError("The inserted reservation's lock was already used.");
  }
  if (issued.kind === "inserted") issued.spent = true;
  return { kind: issued.kind, reservationId: issued.reservationId, storeId: issued.storeId };
}

/** What the database tests watch and steer. Production never sets the hook. */
export interface ReservationChangeTestHooks {
  /** Runs of the owner entry that started over, since the last reset. */
  restarts: number;
  /** Runs before each reservation row lock, with the products already locked. */
  beforeReservationLock: ((scope: ReservationScope) => Promise<void>) | null;
}

const HOOKS = Symbol.for("louez.reservationChange.testHooks");

const isTestHooks = (value: unknown): value is ReservationChangeTestHooks =>
  typeof value === "object" && value !== null && "restarts" in value;

export function reservationChangeTestHooks(): ReservationChangeTestHooks {
  // On globalThis: a test may load this module twice, through two module systems.
  const existing: unknown = Reflect.get(globalThis, HOOKS);
  if (isTestHooks(existing)) return existing;
  const hooks: ReservationChangeTestHooks = { restarts: 0, beforeReservationLock: null };
  Reflect.set(globalThis, HOOKS, hooks);
  return hooks;
}
