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
  lockActiveJob,
  lockClaimedJob,
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
 * - The result is stored under a key named after the job, so a retried run
 *   overwrites the same file, and the photo's new versions are named after
 *   the job, so the start can say the source's version id.
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

/** Where a job's result is stored: one key per job, so a retry overwrites it. */
export const imageJobKey = (storeId: string, jobId: string, operation: ProductImageOperation) =>
  `${storeId}/products/${jobId}-${SUFFIX[operation]}.webp`;

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
    source: { url: input.sourceUrl, versionId: input.sourceVersionId },
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
        rechargeUrl: dashboardPageLinks(ports.urls, store, "/dashboard/ai-credits?recharge=1")
          .dashboard,
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
        state: { productId: product.id, imageUrl: input.imageUrl, operation, priceMicro: quote.priceMicro },
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
  const key = imageJobKey(outcome.job.storeId, outcome.job.id, input.operation);
  const port = ports.productImages;
  if (outcome.kind === "abandoned") {
    // An earlier run may have stored the result: nobody will use it now.
    await port?.discard(key).catch(() => {});
    return;
  }

  const claimed: ClaimedJob = outcome;
  const fail = async (error: ReturnType<typeof jobError>) => {
    const { ended } = await recordJobFailure(claimed, error).catch(() => ({ ended: false }));
    if (ended) await port?.discard(key).catch(() => {});
  };
  if (!port) {
    await fail(
      jobError("AI_IMAGE_UNAVAILABLE", "AI photo processing is not available on this instance."),
    );
    return;
  }
  const source = port.resolveSource(claimed.job.storeId, input.sourceUrl);
  if (!source) {
    await fail(jobError("IMAGE_NOT_PROCESSABLE", "The original photo cannot be processed."));
    return;
  }

  const [productRow] = await db
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.id, claimed.job.targetId), eq(products.storeId, claimed.job.storeId)));

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
      storeId: claimed.job.storeId,
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
    | { kind: "succeeded"; debitedMicro: number; store: { name: string; slug: string; userId: string }; productName: string }
    | { kind: "failed" }
    | { kind: "lost" };
  try {
    finished = await db.transaction(async (tx) => {
      const { storeId } = claimed.job;
      if (!(await lockStoreRow(tx, storeId))) return { kind: "lost" } as const;
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
      // A runner that lost its claim writes nothing, and leaves the file to the winner.
      if (!(await lockClaimedJob(tx, claimed.job.id, claimed.token))) {
        return { kind: "lost" } as const;
      }
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
      if (lineage ? lineage.versions.length >= PRODUCT_IMAGE_VERSIONS_MAX : histories.length >= PRODUCT_LIST_LIMITS.images) {
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
      const nextImages = [...images];
      nextImages[slot] = processed.url;

      const debitedMicro = await port.debit(tx, {
        storeId,
        operation: input.operation,
        dedupKey: `${DEDUP_PREFIX[input.operation]}:${claimed.job.id}`,
        imageKey: key,
        providerCostMicroUsd: processed.providerCostMicroUsd,
      });
      await tx
        .update(products)
        .set({ images: nextImages, imageHistory: nextHistories, updatedAt: new Date() })
        .where(and(eq(products.id, product.id), eq(products.storeId, storeId)));
      await completeJob(tx, claimed.job.id, claimed.token, {
        url: processed.url,
        versionId: ids.versionId,
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
    });
  } catch (error) {
    // The debit or the write failed: nothing committed. The file stays for the retry.
    logProviderError("image_job.record_failed", error);
    await fail(jobError("DEBIT_FAILED", "The result could not be recorded.", true));
    return;
  }

  if (finished.kind === "failed") {
    await port.discard(key).catch(() => {});
    return;
  }
  if (finished.kind === "lost") return;

  try {
    ports.afterCommit({
      type: "product.updated",
      store: {
        id: claimed.job.storeId,
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
    storeId: claimed.job.storeId,
    runId: claimed.job.id,
    operation: input.operation,
    sourceKey: source.key,
    key,
    debitedMicro: finished.debitedMicro,
    report: processed.report,
  });
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
