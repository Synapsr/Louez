import type {
  ProductImageFailure,
  ProductImageOperation,
  ProductImageQuote,
  ProductImagesPort,
} from "./ports";

/** What a test sets, and what the fake records. */
export interface TestProductImagesState {
  quote: ProductImageQuote;
  /** Thrown by the next `process` call, then cleared. */
  failNext: ProductImageFailure | Error | null;
  /** When set, `process` waits for it: a barrier for races and timeouts. */
  gate: Promise<void> | null;
  /** The next debit throws, then this is cleared. */
  debitFailsNext: boolean;
  processed: Array<{ key: string; operation: ProductImageOperation; productName: string }>;
  stored: Set<string>;
  discarded: string[];
  afterSuccess: Array<{ runId: string; debitedMicro: number }>;
}

/**
 * The AI photo port of a test deployment: no provider is called. A source is
 * any URL under `publicBaseUrl/<storeId>/products/`; processing stores a
 * result named after the key; the debit writes a real `ai_credit_debits` row
 * in the caller's transaction (a savepoint), once per dedup key, for the
 * price it is given.
 */
export function createTestProductImages(publicBaseUrl = "https://files.louez.test"): {
  port: ProductImagesPort;
  state: TestProductImagesState;
} {
  const state: TestProductImagesState = {
    quote: {
      available: true,
      priceMicro: 2_000_000,
      credits: { allowed: true, monthlyRemainingMicro: 0, prepaidMicro: 10_000_000 },
    },
    failNext: null,
    gate: null,
    debitFailsNext: false,
    processed: [],
    stored: new Set(),
    discarded: [],
    afterSuccess: [],
  };
  const port: ProductImagesPort = {
    quote: async () => state.quote,
    resolveSource: (storeId, url) => {
      const prefix = `${publicBaseUrl}/${storeId}/products/`;
      if (!url.startsWith(prefix) || !/\.(?:jpe?g|png|webp)$/.test(url)) return null;
      return { kind: "stored", key: url.slice(publicBaseUrl.length + 1) };
    },
    process: async ({ key, operation, productName, signal }) => {
      state.processed.push({ key, operation, productName });
      if (state.gate) {
        const gate = state.gate;
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          void gate.then(resolve);
        });
      }
      const failure = state.failNext;
      state.failNext = null;
      if (failure) throw failure;
      state.stored.add(key);
      return {
        url: `${publicBaseUrl}/${key}`,
        framingMode: "auto",
        providerCostMicroUsd: 40_000,
        report: { key },
      };
    },
    discard: async (key) => {
      state.discarded.push(key);
      state.stored.delete(key);
    },
    debit: async (tx, input) => {
      if (state.debitFailsNext) {
        state.debitFailsNext = false;
        throw new Error("The ledger is down.");
      }
      const { priceMicro } = input;
      const { aiCreditDebits, isDuplicateKeyError } = await import("@louez/db");
      try {
        await tx.transaction((savepoint) =>
          savepoint.insert(aiCreditDebits).values({
            storeId: input.storeId,
            kind: "image_enhancement",
            imageKey: input.imageKey,
            dedupKey: input.dedupKey,
            costMicroUsd: input.providerCostMicroUsd,
            debitedMicro: priceMicro,
            fromMonthlyMicro: 0,
            fromPrepaidMicro: priceMicro,
          }),
        );
        return priceMicro;
      } catch (error) {
        if (isDuplicateKeyError(error)) return 0;
        throw error;
      }
    },
    afterSuccess: async ({ runId, debitedMicro }) => {
      state.afterSuccess.push({ runId, debitedMicro });
    },
  };
  return { port, state };
}
