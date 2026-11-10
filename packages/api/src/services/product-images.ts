import { apiJobs, db, lockStoreRow, products, stores, type ApiJobKind } from "@louez/db";
import type { ProductImageHistory } from "@louez/types";
import {
  PRODUCT_IMAGE_VERSIONS_MAX,
  appendProductImageVersion,
  canApplyProductImageOperation,
  findProductImageHistory,
  getProductImageProcessingKind,
  productImageSlot,
  productImageVersionKindOf,
  selectProductImageVersion,
} from "@louez/utils";
import { PRODUCT_LIST_LIMITS } from "@louez/validations";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { JobView } from "../contracts/jobs";
import { productErrors, productImageErrors } from "../contracts/products";
import type { StoreActor } from "../platform/actor";
import { checkConfirmation } from "../platform/confirmation";
import { platformErrors } from "../platform/errors";
import { sha256 } from "../platform/hash";
import {
  claimJob,
  completeJob,
  countActiveJobs,
  failJobInTransaction,
  JOB_LEASE_MARGIN_MS,
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  lockActiveJob,
  lockClaimedJob,
  lockJob,
  queueJob,
  recordJobFailure,
  type ClaimedJob,
  type JobRow,
} from "../platform/jobs";
import { dashboardPageLinks, productLinks, type LinkStore } from "../platform/links";
import {
  ProductImageFailure,
  type ApiPorts,
  type ProductImageOperation,
  type ProductImagesPort,
  type ProductImageQuote,
} from "../platform/ports";
import { logProviderError } from "../platform/redact";

/**
 * AI photo operations on a product's photo, for agents and the API: GPT
 * Image with a cut-out background (`enhance`), or the cut-out alone
 * (`remove-background`). Each runs for minutes, longer than a tool call
 * may wait, so a call queues a job (platform/jobs.ts) and answers with it;
 * `jobs.get` follows it.
 *
 * - The result replaces the photo on the product, and joins the photo's
 *   versions (`image_history`), where the original stays:
 *   `products.useImageVersion` puts any version back.
 * - Nothing is charged before the result exists: the debit is written in
 *   the transaction that puts the result on the product and marks the job
 *   succeeded, once per job (`imgenh:<jobId>`, `imgbg:<jobId>`). A failed,
 *   abandoned or discarded run is never charged.
 * - Each run stores its result under its own key (`<jobId>-<attempt>`), so
 *   a stale run never overwrites the winner's file; only the winner's goes
 *   on the product. The photo's new versions are named after the job, so the
 *   start can say the source's version id.
 * - The pipeline and the credits are the app's (`ports.productImages`), the
 *   same code as the dashboard's enhance route.
 */

const MICRO_PER_CREDIT = 1_000_000;
const credits = (micro: number) => micro / MICRO_PER_CREDIT;

/** Jobs a store may have queued or running at once: the providers' capacity, and a bound on a negative balance. */
export const ACTIVE_IMAGE_JOBS_MAX = 3;

export const IMAGE_JOB_KINDS = {
  enhance: "product_image_enhance",
  "remove-background": "product_image_remove_background",
} as const satisfies Record<ProductImageOperation, ApiJobKind>;

const OPERATIONS: Record<ApiJobKind, ProductImageOperation> = {
  product_image_enhance: "enhance",
  product_image_remove_background: "remove-background",
};

/** How long each operation usually takes, from its start. */
export const IMAGE_JOB_SECONDS = {
  enhance: { min: 60, max: 240 },
  "remove-background": { min: 10, max: 120 },
} as const satisfies Record<ProductImageOperation, { min: number; max: number }>;

/** "1 to 4 minutes": how long an operation usually takes, as the texts say it. */
export const imageJobDuration = (operation: ProductImageOperation) => {
  const { min, max } = IMAGE_JOB_SECONDS[operation];
  return `${Math.max(1, Math.round(min / 60))} to ${Math.round(max / 60)} minutes`;
};

const POLL_AFTER_SECONDS: Record<ProductImageOperation, number> = {
  enhance: 20,
  "remove-background": 10,
};

const SUFFIX: Record<ProductImageOperation, string> = { enhance: "ai", "remove-background": "bg" };
const DEDUP_PREFIX: Record<ProductImageOperation, string> = {
  enhance: "imgenh",
  "remove-background": "imgbg",
};
const VERB: Record<ProductImageOperation, { doing: string; done: string; noun: string }> = {
  enhance: { doing: "Enhancing", done: "The enhanced photo", noun: "AI enhancement" },
  "remove-background": {
    doing: "Removing the background of",
    done: "The photo without its background",
    noun: "background removal",
  },
};

/**
 * Where one run of a job stores its result: a key per job and attempt, never
 * written by another run, so a runner that lost its claim can never overwrite
 * the result that won. It ends in `-ai.webp` / `-bg.webp`, which tells a
 * processed photo apart (`canApplyProductImageOperation`).
 */
export const imageJobKey = (
  storeId: string,
  jobId: string,
  operation: ProductImageOperation,
  attempt: number,
) => `${storeId}/products/${jobId}-${attempt}-${SUFFIX[operation]}.webp`;

/** The keys every run of a job may have written, but `except`. */
const otherRunKeys = (
  job: { storeId: string; id: string },
  operation: ProductImageOperation,
  except: number | null,
) =>
  Array.from({ length: JOB_MAX_ATTEMPTS }, (_, index) => index + 1)
    .filter((attempt) => attempt !== except)
    .map((attempt) => imageJobKey(job.storeId, job.id, operation, attempt));

/** The ids a job gives the versions it adds, so the start can name the source's. */
const jobVersionIds = (jobId: string) => ({
  versionId: `product-image-version-${jobId}`,
  historyId: `product-image-history-${jobId}`,
  sourceVersionId: `product-image-version-${jobId}-source`,
});

/** One job per product photo at a time, whatever the operation. */
const slotKeyOf = (productId: string, imageUrl: string) => sha256(`${productId}\n${imageUrl}`);

const jobInputSchema = z.object({
  operation: z.enum(["enhance", "remove-background"]),
  sourceUrl: z.string(),
  sourceVersionId: z.string(),
  priceMicro: z.number(),
});
type ImageJobInput = z.infer<typeof jobInputSchema>;

const jobResultSchema = z.object({
  url: z.string(),
  versionId: z.string(),
  /** The source's version id as the photo's versions hold it once the result is in. */
  sourceVersionId: z.string(),
  key: z.string(),
  debitedMicro: z.number(),
  framingMode: z.string().nullable(),
});
type ImageJobResult = z.infer<typeof jobResultSchema>;

// --- Reading a job -----------------------------------------------------------

/** The product a job's view links to; null when it was deleted. */
type JobProduct = { id: string; slug: string | null; status: string | null } | null;

function jobSummary(job: JobRow, input: ImageJobInput): string {
  const verb = VERB[input.operation];
  switch (job.status) {
    case "queued":
      return job.error
        ? `The last run failed (${job.error.message}); it runs again within a few minutes. Nothing was charged.`
        : "Waiting to start.";
    case "running":
      return `${verb.doing} the photo: it usually takes ${imageJobDuration(input.operation)}.`;
    case "succeeded":
      return `${verb.done} replaced the original on the product. The original stays among the photo's versions.`;
    case "failed":
      return `The ${verb.noun} failed: ${job.error?.message ?? "unknown error."} Nothing was charged.`;
  }
}

/** A job as `jobs.get` and the start return it. */
export function imageJobView(
  job: JobRow,
  context: { urls: ApiPorts["urls"]; store: LinkStore; product: JobProduct },
): JobView {
  const input = jobInputSchema.parse(job.input);
  const result = job.status === "succeeded" ? jobResultSchema.parse(job.result) : null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    summary: jobSummary(job, input),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempts: job.attempts,
    estimatedSeconds: IMAGE_JOB_SECONDS[input.operation],
    pollAfterSeconds: POLL_AFTER_SECONDS[input.operation],
    productId: job.targetId,
    priceCredits: credits(input.priceMicro),
    // Once done, the id the photo's versions hold: a dashboard save meanwhile may have named it.
    source: { url: input.sourceUrl, versionId: result?.sourceVersionId ?? input.sourceVersionId },
    result: result
      ? {
          url: result.url,
          versionId: result.versionId,
          creditsCharged: credits(result.debitedMicro),
        }
      : null,
    error: job.status === "failed" ? job.error : null,
    links: productLinks(context.urls, context.store, context.product ?? { id: job.targetId }),
  };
}

/** The product a job links to, as its view needs it. */
export async function jobProduct(storeId: string, productId: string): Promise<JobProduct> {
  const [row] = await db
    .select({ id: products.id, slug: products.slug, status: products.status })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)));
  return row ?? null;
}

// --- Starting a job ----------------------------------------------------------

/** Who starts a job, and what the procedure lends it. */
export interface ImageJobStarter {
  actor: StoreActor;
  store: LinkStore & { name: string };
  ports: ApiPorts;
  headers: Headers;
  /** The procedure's path: the confirmation is bound to it. */
  procedure: string;
  operationId: string | null;
}

const balanceText = (quote: ProductImageQuote) => {
  if (!quote.credits) return null;
  const { monthlyRemainingMicro, prepaidMicro } = quote.credits;
  if (monthlyRemainingMicro === null) return "included credits: unlimited this month";
  const total = credits(monthlyRemainingMicro + prepaidMicro);
  return monthlyRemainingMicro > 0
    ? `balance: ${total}, of which ${credits(monthlyRemainingMicro)} included this month`
    : `balance: ${total}`;
};

const requirePort = (ports: ApiPorts, operation: ProductImageOperation): ProductImagesPort => {
  if (!ports.productImages) throw productImageErrors.unavailable(operation);
  return ports.productImages;
};

/**
 * Starts an operation on one photo of a product, or returns the job that
 * already runs it. Every check runs under the store's and the product's
 * locks; a paid run asks every agent for a confirmation first, even one whose
 * confirmations are turned off. Nothing is charged here.
 */
export async function startImageJob(
  starter: ImageJobStarter,
  input: { id: string; imageUrl: string },
  operation: ProductImageOperation,
): Promise<JobView> {
  const { actor, ports, store } = starter;
  const port = requirePort(ports, operation);
  // Outside the transaction: the app reads the credits on its own connection.
  const quote = await port.quote(actor.storeId, operation);
  if (!quote.available) throw productImageErrors.unavailable(operation);
  const source = port.resolveSource(actor.storeId, input.imageUrl);
  const kind = IMAGE_JOB_KINDS[operation];
  const slotKey = slotKeyOf(input.id, input.imageUrl);

  let refusal: Error | null = null;
  let queued: string | null = null;
  const job = await db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, actor.storeId))) throw platformErrors.noStore();
    const [product] = await tx
      .select({
        id: products.id,
        name: products.name,
        images: products.images,
        imageHistory: products.imageHistory,
      })
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.storeId, actor.storeId)))
      .for("update");
    if (!product) throw productErrors.notFound(input.id);

    // The same photo again while its job runs: that job, with no new charge.
    const active = await lockActiveJob(tx, actor.storeId, slotKey);
    if (active) {
      if (active.kind !== kind) throw productImageErrors.otherJobRunning(active.id);
      return active;
    }

    const images = product.images ?? [];
    const histories: ProductImageHistory[] = product.imageHistory ?? [];
    const position = images.indexOf(input.imageUrl);
    if (position === -1) throw productImageErrors.notOnProduct(input.imageUrl);
    if (!source) throw productImageErrors.notProcessable();
    if (!canApplyProductImageOperation(input.imageUrl, operation)) {
      throw productImageErrors.alreadyProcessed(
        getProductImageProcessingKind(input.imageUrl) ?? "ai-enhanced",
      );
    }
    const lineage = findProductImageHistory(histories, input.imageUrl);
    if (lineage && lineage.versions.length >= PRODUCT_IMAGE_VERSIONS_MAX) {
      throw productImageErrors.historyFull("versions", PRODUCT_IMAGE_VERSIONS_MAX);
    }
    if (!lineage && histories.length >= PRODUCT_LIST_LIMITS.images) {
      throw productImageErrors.historyFull("photos", PRODUCT_LIST_LIMITS.images);
    }
    const imageKinds = Object.values(IMAGE_JOB_KINDS);
    if ((await countActiveJobs(tx, actor.storeId, imageKinds)) >= ACTIVE_IMAGE_JOBS_MAX) {
      throw productImageErrors.busy(ACTIVE_IMAGE_JOBS_MAX);
    }
    if (quote.credits && !quote.credits.allowed) {
      throw productImageErrors.creditsExhausted({
        priceCredits: credits(quote.priceMicro),
        balanceCredits: credits(
          (quote.credits.monthlyRemainingMicro ?? 0) + quote.credits.prepaidMicro,
        ),
        // No purchase prompt where the client's directory forbids it (`ClientWithholding.purchases`).
        rechargeUrl: actor.credential.withheld?.purchases
          ? null
          : dashboardPageLinks(ports.urls, store, "/dashboard/ai-credits?recharge=1").dashboard,
      });
    }

    // Spending credits is the user's call, whatever the connection says.
    if (quote.priceMicro > 0) {
      const balance = balanceText(quote);
      const summary = `${VERB[operation].doing} photo ${position + 1} of "${product.name}" costs ${credits(quote.priceMicro)} AI credits${balance ? ` (${balance})` : ""}. In about ${imageJobDuration(operation)} the result replaces this photo on the product${store.onboardingCompleted ? " and its online page" : ""}; the original stays among the photo's versions, and products_use_image_version puts it back. Nothing is charged if it fails.`;
      refusal = await checkConfirmation({
        executor: tx,
        always: true,
        actor,
        headers: starter.headers,
        procedure: starter.procedure,
        input,
        // Not the balance: another spend would void every preview.
        state: {
          productId: product.id,
          imageUrl: input.imageUrl,
          operation,
          priceMicro: quote.priceMicro,
        },
        preview: {
          summary,
          details: {
            product: { id: product.id, name: product.name },
            photo: { position: position + 1, url: input.imageUrl },
            operation,
            priceCredits: credits(quote.priceMicro),
            estimatedSeconds: IMAGE_JOB_SECONDS[operation],
          },
        },
      });
      // The preview's row commits with this transaction; nothing else was written.
      if (refusal) return null;
    }

    const jobId = nanoid();
    const sourceVersionId =
      lineage?.versions.find((version) => version.url === input.imageUrl)?.id ??
      jobVersionIds(jobId).sourceVersionId;
    queued = await queueJob(
      tx,
      {
        storeId: actor.storeId,
        kind,
        targetId: product.id,
        slotKey,
        input: {
          operation,
          sourceUrl: input.imageUrl,
          sourceVersionId,
          priceMicro: quote.priceMicro,
        } satisfies ImageJobInput,
        operationId: starter.operationId,
        userId: actor.credential.userId,
        credentialKind: actor.credential.kind,
        credentialId: actor.credential.id,
        clientName: actor.credential.clientName,
      },
      jobId,
    );
    const [row] = await tx.select().from(apiJobs).where(eq(apiJobs.id, jobId));
    return row ?? null;
  });

  if (refusal) throw refusal;
  if (!job) throw productErrors.notFound(input.id);
  if (queued) ports.dispatchJobs?.([queued]);
  return imageJobView(job, {
    urls: ports.urls,
    store,
    product: await jobProduct(actor.storeId, job.targetId),
  });
}

// --- Running a job -----------------------------------------------------------

/** How the transaction that records a job's result runs (see `runImageJob`). */
const IMAGE_RESULT_TRANSACTION = { isolationLevel: "read committed" } as const;

export interface RunJobOptions {
  /** How long a claim holds the job. Tests shorten it. */
  leaseMs?: number;
}

/** A failure the job records as it is: a refusal of its own, not a provider's. */
const jobError = (code: string, message: string, retryable = false) => ({
  code,
  message,
  retryable,
});

const TIMED_OUT = jobError(
  "JOB_TIMED_OUT",
  "The photo took too long to process. It runs again shortly.",
  true,
);

const FAILURE_MESSAGES: Record<ProductImageFailure["code"], string> = {
  IMAGE_SOURCE_UNREADABLE: "The original photo could not be read.",
  IMAGE_EMPTY: "The AI returned an empty image for this photo. Try another photo.",
  PROVIDER_ERROR: "The AI image service did not answer.",
  BACKGROUND_REMOVAL_ERROR: "The background removal service did not answer.",
  STORAGE_ERROR: "The result could not be stored.",
  PROCESSING_ERROR: "The photo could not be processed.",
};

/**
 * Runs one job: claims it, processes the photo, then in one transaction
 * debits the store, puts the result on the product and marks the job
 * succeeded. A failure is recorded on the job, and a run that may pass is
 * queued again for the cron; `runJob` (services/jobs.ts) logs anything else.
 */
export async function runImageJob(
  id: string,
  ports: ApiPorts,
  options: RunJobOptions = {},
): Promise<void> {
  const leaseMs = options.leaseMs ?? JOB_LEASE_MS;
  const outcome = await claimJob(id, leaseMs);
  if (!outcome) return;
  const input = jobInputSchema.parse(outcome.job.input);
  const port = ports.productImages;
  const discard = async (keys: readonly string[]) => {
    for (const key of keys) await port?.discard(key).catch(() => {});
  };
  if (outcome.kind === "abandoned") {
    // Earlier runs may have stored a result: nobody will use any of them now.
    await discard(otherRunKeys(outcome.job, input.operation, null));
    return;
  }

  const claimed: ClaimedJob = outcome;
  const { storeId } = claimed.job;
  // This run's own key: no other run writes it. This run deletes it only once
  // it knows no committed result points at it: a failure it wrote itself, or a
  // claim it saw lost (or a job gone) under the job's lock.
  const key = imageJobKey(storeId, claimed.job.id, input.operation, claimed.job.attempts);
  const fail = async (error: ReturnType<typeof jobError>) => {
    const recorded = await recordJobFailure(claimed, error).catch(() => false);
    // Not written (the claim was taken over, or the database did not answer):
    // keep the file, an orphan rather than a result pointing at nothing.
    if (recorded) await discard([key]);
  };
  if (!port) {
    await fail(
      jobError("AI_IMAGE_UNAVAILABLE", "AI photo processing is not available on this instance."),
    );
    return;
  }
  const source = port.resolveSource(storeId, input.sourceUrl);
  if (!source) {
    await fail(jobError("IMAGE_NOT_PROCESSABLE", "The original photo cannot be processed."));
    return;
  }

  const [productRow] = await db
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.id, claimed.job.targetId), eq(products.storeId, storeId)));

  // Abort before the lease ends, counted from the claim, so a takeover never
  // overlaps a provider call that honours the signal.
  const allowedMs = Math.max(0, leaseMs - Math.min(JOB_LEASE_MARGIN_MS, leaseMs / 4));
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timed out")),
    Math.max(0, claimed.grantedAt + allowedMs - performance.now()),
  );
  let processed: Awaited<ReturnType<ProductImagesPort["process"]>>;
  try {
    processed = await port.process({
      storeId,
      source,
      operation: input.operation,
      productName: productRow?.name ?? "",
      key,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      await fail(TIMED_OUT);
    } else if (error instanceof ProductImageFailure) {
      await fail(jobError(error.code, FAILURE_MESSAGES[error.code], error.retryable));
    } else {
      logProviderError("image_job.process_failed", error);
      await fail(jobError("PROCESSING_ERROR", FAILURE_MESSAGES.PROCESSING_ERROR, true));
    }
    return;
  } finally {
    clearTimeout(timer);
  }

  const versionKind = productImageVersionKindOf(input.operation);
  let finished:
    | {
        kind: "succeeded";
        debitedMicro: number;
        store: { name: string; slug: string; userId: string };
        productName: string;
      }
    /** Ended without a result: the product or the photo is gone, or the versions are full. */
    | { kind: "failed" }
    /** Another runner holds the job now: this run's result is not the one used. */
    | { kind: "lost" }
    /** The store or the job is gone (the account was deleted): nothing will ever use the result. */
    | { kind: "gone" };
  try {
    // READ COMMITTED, as the debit needs (`ProductImagesPort.debit`): its sum of
    // the month's credits sees what committed while it waited for the credits'
    // lock. Every row this transaction relies on is read with a lock (the
    // store, the product, the job's claim), so nothing else changes.
    finished = await db.transaction(async (tx) => {
      if (!(await lockStoreRow(tx, storeId))) return { kind: "gone" } as const;
      const [product] = await tx
        .select({
          id: products.id,
          name: products.name,
          images: products.images,
          imageHistory: products.imageHistory,
        })
        .from(products)
        .where(and(eq(products.id, claimed.job.targetId), eq(products.storeId, storeId)))
        .for("update");
      const claim = await lockClaimedJob(tx, claimed.job.id, claimed.token);
      if (claim !== "held") return { kind: claim } as const;
      const failWith = async (error: ReturnType<typeof jobError>) => {
        await failJobInTransaction(tx, claimed.job.id, claimed.token, error);
        return { kind: "failed" } as const;
      };
      if (!product) {
        return failWith(
          jobError("PRODUCT_NOT_FOUND", "The product was deleted before the photo was ready."),
        );
      }

      const images = product.images ?? [];
      const histories: ProductImageHistory[] = product.imageHistory ?? [];
      const lineage = findProductImageHistory(histories, input.sourceUrl);
      // The photo's place now: the source, or whichever of its versions took it since.
      const slot = lineage ? productImageSlot(images, lineage) : images.indexOf(input.sourceUrl);
      if (slot === -1) {
        return failWith(
          jobError(
            "IMAGE_NO_LONGER_ON_PRODUCT",
            "The photo was removed from the product before the result was ready.",
          ),
        );
      }
      const full = lineage
        ? lineage.versions.length >= PRODUCT_IMAGE_VERSIONS_MAX
        : histories.length >= PRODUCT_LIST_LIMITS.images;
      if (full) {
        return failWith(
          jobError("IMAGE_HISTORY_FULL", "The photo's versions are full: the result was not kept."),
        );
      }

      const ids = jobVersionIds(claimed.job.id);
      const nextHistories = appendProductImageVersion(
        histories,
        input.sourceUrl,
        processed.url,
        versionKind,
        { ...ids, sourceVersionId: input.sourceVersionId, createdAt: new Date().toISOString() },
      );
      // The source keeps the id its lineage gave it: the one announced at the
      // start, or the one a dashboard save gave it meanwhile.
      const sourceVersionId =
        findProductImageHistory(nextHistories, input.sourceUrl)?.versions.find(
          (version) => version.url === input.sourceUrl,
        )?.id ?? input.sourceVersionId;
      const nextImages = [...images];
      nextImages[slot] = processed.url;

      // The price frozen at the start, which the agent confirmed: never the tariff now.
      const debitedMicro =
        input.priceMicro > 0
          ? await port.debit(tx, {
              storeId,
              priceMicro: input.priceMicro,
              dedupKey: `${DEDUP_PREFIX[input.operation]}:${claimed.job.id}`,
              imageKey: key,
              providerCostMicroUsd: processed.providerCostMicroUsd,
            })
          : 0;
      await tx
        .update(products)
        .set({ images: nextImages, imageHistory: nextHistories, updatedAt: new Date() })
        .where(and(eq(products.id, product.id), eq(products.storeId, storeId)));
      await completeJob(tx, claimed.job.id, claimed.token, {
        url: processed.url,
        versionId: ids.versionId,
        sourceVersionId,
        key,
        debitedMicro,
        framingMode: processed.framingMode,
      } satisfies ImageJobResult);

      const [store] = await tx
        .select({ name: stores.name, slug: stores.slug, userId: stores.userId })
        .from(stores)
        .where(eq(stores.id, storeId));
      return {
        kind: "succeeded",
        debitedMicro,
        store: store ?? { name: "", slug: "", userId: "" },
        productName: product.name,
      } as const;
    }, IMAGE_RESULT_TRANSACTION);
  } catch (error) {
    logProviderError("image_job.record_failed", error);
    // The transaction may still commit, or have committed with its answer
    // lost: settle it under the job's lock before any file is deleted.
    const outcome = await settleUncertainResult(
      claimed,
      key,
      jobError("DEBIT_FAILED", "The result could not be recorded.", true),
    );
    if (outcome === "failed") {
      // This run wrote its failure, so nothing points at its file.
      await discard([key]);
      return;
    }
    // Anything else it cannot be sure of: the file stays.
    if (outcome === "kept") return;
    finished = {
      kind: "succeeded",
      debitedMicro: outcome.debitedMicro,
      store: await eventStoreOf(storeId),
      productName: productRow?.name ?? "",
    };
  }

  if (finished.kind !== "succeeded") {
    await discard([key]);
    return;
  }
  // Earlier runs that stored a result before they stopped: only this one is used.
  await discard(otherRunKeys(claimed.job, input.operation, claimed.job.attempts));

  try {
    ports.afterCommit({
      type: "product.updated",
      store: {
        id: storeId,
        name: finished.store.name,
        slug: finished.store.slug,
        ownerUserId: finished.store.userId,
      },
      productId: claimed.job.targetId,
      productName: finished.productName,
    });
  } catch {
    // The effects of a committed write never fail it.
  }
  await port.afterSuccess({
    storeId,
    runId: claimed.job.id,
    operation: input.operation,
    sourceKey: source.key,
    key,
    debitedMicro: finished.debitedMicro,
    report: processed.report,
  });
}

/**
 * Settles a run whose result transaction failed without a clear answer: it
 * may have committed with its answer lost, or still be running on a broken
 * connection. In a transaction of its own, it locks the job's row, which
 * waits for that transaction to end, then reads what it left:
 *
 * - the job succeeded with this run's file: what it debited;
 * - this run still holds it: records the failure under that lock (`failed`),
 *   so the late transaction, if any, can no longer succeed;
 * - anything else, or no answer from the database: `kept`, and the file
 *   stays, as nothing proves no result points at it.
 */
async function settleUncertainResult(
  claimed: ClaimedJob,
  key: string,
  error: ReturnType<typeof jobError>,
): Promise<{ debitedMicro: number } | "failed" | "kept"> {
  try {
    return await db.transaction(async (tx) => {
      const job = await lockJob(tx, claimed.job.id);
      if (job?.status === "succeeded") {
        const result = jobResultSchema.safeParse(job.result);
        if (result.success && result.data.key === key) {
          return { debitedMicro: result.data.debitedMicro };
        }
      }
      if (job?.status === "running" && job.claimToken === claimed.token) {
        return (await recordJobFailure(claimed, error, tx)) ? "failed" : "kept";
      }
      return "kept";
    });
  } catch {
    return "kept";
  }
}

/** The store as a product event names it; blank when it cannot be read. */
async function eventStoreOf(storeId: string) {
  try {
    const [store] = await db
      .select({ name: stores.name, slug: stores.slug, userId: stores.userId })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (store) return store;
  } catch {
    // The event is best effort; the result is already the store's.
  }
  return { name: "", slug: "", userId: "" };
}

/** The operation a job kind runs; null for a kind that is not an image job. */
export const imageOperationOf = (kind: ApiJobKind): ProductImageOperation | null =>
  OPERATIONS[kind] ?? null;

// --- Switching versions --------------------------------------------------------

/**
 * Puts one of a photo's versions in use: it takes the photo's place in
 * `images`. The versions themselves do not change, so this is how an AI
 * result is undone. Under the store's and the product's locks.
 */
export async function useImageVersion(
  actor: { storeId: string },
  input: { id: string; versionId: string },
): Promise<{ changed: boolean; name: string }> {
  return db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, actor.storeId))) throw platformErrors.noStore();
    const [product] = await tx
      .select({ name: products.name, images: products.images, imageHistory: products.imageHistory })
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.storeId, actor.storeId)))
      .for("update");
    if (!product) throw productErrors.notFound(input.id);
    const images = product.images ?? [];
    const selected = selectProductImageVersion(images, product.imageHistory ?? [], input.versionId);
    if (!selected.ok) {
      throw selected.reason === "version_not_found"
        ? productImageErrors.versionNotFound(input.versionId)
        : productImageErrors.versionPhotoRemoved(input.versionId);
    }
    if (selected.url === selected.previousUrl) return { changed: false, name: product.name };
    await tx
      .update(products)
      .set({ images: selected.images, updatedAt: new Date() })
      .where(and(eq(products.id, input.id), eq(products.storeId, actor.storeId)));
    return { changed: true, name: product.name };
  });
}
