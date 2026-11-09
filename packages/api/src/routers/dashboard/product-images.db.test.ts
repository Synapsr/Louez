import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent, ApiPorts } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestProductImages } from "../../platform/test-product-images";
import { createTestUrls } from "../../platform/test-urls";

// What the image ownership checks read, before the modules that read them load.
process.env.AUTH_SECRET ??= "product-images-test-secret";
process.env.S3_PUBLIC_URL = "https://files.louez.test";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@pi.test` } } : null;
        },
      },
    },
  },
});

// AI photo jobs end to end on the database: an agent or the dashboard starts
// one, the runner processes it with a fake pipeline (no provider is called),
// and the result, its debit and the job's end are written together.

const OWNER = "pi_owner_user_000001";
const STORE = "pi_store_a_000000001";
const OTHER_STORE = "pi_store_b_000000001";
const FILES = "https://files.louez.test";
const photo = (name: string, storeId = STORE) => `${FILES}/${storeId}/products/${name}.png`;

describe("AI photo jobs (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let images: typeof import("../../services/product-images");
  let jobsService: typeof import("../../services/jobs");
  let jobs: typeof import("../../platform/jobs");
  let routers: {
    products: typeof import("./products").dashboardProductsRouter;
    jobs: typeof import("./jobs").dashboardJobsRouter;
    inbox: typeof import("./inbox").dashboardInboxRouter;
  };

  const events: ApiEvent[] = [];
  const dispatched: string[] = [];
  let fake = createTestProductImages(FILES);
  const ports: ApiPorts = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    dispatchJobs: (ids) => {
      dispatched.push(...ids);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event) => {
      events.push(event);
    },
    get productImages() {
      return fake.port;
    },
  };

  before(async () => {
    database = await createTestDatabase("api_product_images");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    images = await import("../../services/product-images");
    jobsService = await import("../../services/jobs");
    jobs = await import("../../platform/jobs");
    routers = {
      products: (await import("./products")).dashboardProductsRouter,
      jobs: (await import("./jobs")).dashboardJobsRouter,
      inbox: (await import("./inbox")).dashboardInboxRouter,
    };

    await louezDb.db.insert(louezDb.users).values([{ id: OWNER, email: "owner@pi.test" }]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "pi-store-a", onboardingCompleted: true },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "pi-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    events.length = 0;
    dispatched.length = 0;
    fake = createTestProductImages(FILES);
    await louezDb.db.delete(louezDb.apiJobs);
    await louezDb.db.delete(louezDb.aiCreditDebits);
    await louezDb.db.delete(louezDb.apiConfirmations);
    await louezDb.db.delete(louezDb.apiOperations);
    await louezDb.db.delete(louezDb.products);
  });

  // --- Callers --------------------------------------------------------------

  function session(store = STORE): BaseContext {
    return {
      headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${store}` }),
      transport: "rpc",
      ports,
      receipt: {},
    };
  }

  async function apiKey(
    options: { confirmSensitive?: boolean; products?: "read" | "write" | "none" } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Photo agent",
      permissions: {
        reservations: "read",
        products: options.products ?? "write",
        customers: "none",
        categories: "read",
        payments: "none",
        analytics: "none",
        settings: "read",
      },
    });
    if (options.confirmSensitive === false) {
      await louezDb.db
        .update(louezDb.apiKeys)
        .set({ confirmSensitive: false })
        .where(orm.eq(louezDb.apiKeys.id, created.id));
    }
    return (extra: Record<string, string> = {}): BaseContext => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi",
      ports,
      receipt: {},
    });
  }

  type Products = RouterClient<typeof routers.products>;

  /** Calls a products procedure as a transport would, with its full path. */
  function products<K extends keyof Products>(
    name: K,
    input: Parameters<Products[K]>[0],
    context: BaseContext,
  ): ReturnType<Products[K]> {
    const client = orpc.createRouterClient(routers.products, {
      context,
      path: ["dashboard", "products"],
    }) as Products;
    const procedure = client[name] as (input: Parameters<Products[K]>[0]) => ReturnType<Products[K]>;
    return procedure(input);
  }
  const getJob = (input: Parameters<RouterClient<typeof routers.jobs>["get"]>[0], context: BaseContext) =>
    (
      orpc.createRouterClient(routers.jobs, { context, path: ["dashboard", "jobs"] }) as RouterClient<
        typeof routers.jobs
      >
    ).get(input);
  const inbox = (context: BaseContext) =>
    (
      orpc.createRouterClient(routers.inbox, { context, path: ["dashboard", "inbox"] }) as RouterClient<
        typeof routers.inbox
      >
    ).list({});

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as { data: { code: string; details?: Record<string, unknown> } };
  }

  async function product(imageUrls: string[], storeId = STORE) {
    const created = await products(
      "create",
      { name: "Tente 4 places", price: "30", images: imageUrls },
      session(storeId),
    );
    return created.id;
  }

  const productRow = async (id: string) => {
    const [row] = await louezDb.db
      .select({ images: louezDb.products.images, imageHistory: louezDb.products.imageHistory })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.id, id));
    return row;
  };
  const jobRow = async (id: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiJobs)
      .where(orm.eq(louezDb.apiJobs.id, id));
    return row;
  };
  const debits = () =>
    louezDb.db
      .select({
        dedupKey: louezDb.aiCreditDebits.dedupKey,
        debitedMicro: louezDb.aiCreditDebits.debitedMicro,
      })
      .from(louezDb.aiCreditDebits);
  /** Makes a queued job due now, as the cron would find it after its wait. */
  const makeDue = (id: string) =>
    louezDb.db
      .update(louezDb.apiJobs)
      .set({ nextAttemptAt: orm.sql`NOW(3) - INTERVAL 1 SECOND` })
      .where(orm.eq(louezDb.apiJobs.id, id));
  const expireLease = (id: string) =>
    louezDb.db
      .update(louezDb.apiJobs)
      .set({ lockedUntil: orm.sql`NOW(3) - INTERVAL 1 SECOND` })
      .where(orm.eq(louezDb.apiJobs.id, id));

  // --- Start, run, read -----------------------------------------------------

  test("the dashboard enhances a photo: no confirmation, then the result replaces it, debited once", async () => {
    const source = photo("tent-1");
    const id = await product([photo("cover"), source]);

    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    assert.equal(started.status, "queued");
    assert.equal(started.kind, "product_image_enhance");
    assert.equal(started.priceCredits, 2);
    assert.deepEqual(started.source, {
      url: source,
      versionId: `product-image-version-${started.id}-source`,
    });
    assert.equal(started.result, null);
    assert.deepEqual(dispatched, [started.id]);
    assert.match(started.links.dashboard, new RegExp(`/dashboard/products/${id}`));

    await images.runImageJob(started.id, ports);

    const done = await getJob({ id: started.id }, session());
    assert.equal(done.status, "succeeded");
    const resultUrl = `${FILES}/${STORE}/products/${started.id}-ai.webp`;
    assert.deepEqual(done.result, {
      url: resultUrl,
      versionId: `product-image-version-${started.id}`,
      creditsCharged: 2,
    });
    assert.equal(done.error, null);

    const row = await productRow(id);
    assert.deepEqual(row?.images, [photo("cover"), resultUrl]);
    assert.deepEqual(
      row?.imageHistory?.[0]?.versions.map(({ id: versionId, url, kind }) => [versionId, url, kind]),
      [
        [`product-image-version-${started.id}-source`, source, "original"],
        [`product-image-version-${started.id}`, resultUrl, "ai-enhanced"],
      ],
    );
    assert.deepEqual(await debits(), [{ dedupKey: `imgenh:${started.id}`, debitedMicro: 2_000_000 }]);
    assert.deepEqual(fake.state.afterSuccess, [{ runId: started.id, debitedMicro: 2_000_000 }]);
    assert.deepEqual(
      events.filter((event) => event.type === "product.updated").map((event) => event.productId),
      [id],
    );
    // The job's slot is free again, and the run is not run twice.
    assert.equal((await jobRow(started.id))?.activeSlot, null);
    await images.runImageJob(started.id, ports);
    assert.equal((await debits()).length, 1);

    // products_get shows both versions, the result in use.
    const read = await products("get", { id }, session());
    assert.deepEqual(
      read.imageVersions[1]?.versions.map((version) => [
        version.url,
        version.current,
      ]),
      [
        [source, false],
        [resultUrl, true],
      ],
    );
  });

  test("an agent gets a preview with the price, then starts the job with its token", async () => {
    const source = photo("tent-2");
    const id = await product([source]);
    const key = await apiKey();

    const refusal = await rejects(
      products("enhanceImage", { id, imageUrl: source }, key()),
      "CONFIRMATION_REQUIRED",
    );
    const preview = refusal.data.details?.preview as { summary: string };
    assert.match(preview.summary, /photo 1 of "Tente 4 places" costs 2 AI credits \(balance: 10\)/);
    assert.match(preview.summary, /replaces this photo on the product and its online page/);
    assert.match(preview.summary, /products_use_image_version puts it back/);
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 0);

    const token = refusal.data.details?.confirmationToken as string;
    const started = await products(
      "enhanceImage",
      { id, imageUrl: source },
      key({ "louez-confirmation": token }),
    );
    assert.equal(started.status, "queued");
    const [row] = await louezDb.db.select().from(louezDb.apiJobs);
    assert.equal(row?.credentialKind, "api_key");
    assert.ok(row?.operationId, "the job names the write that started it");
  });

  test("spending credits asks a connection whose confirmations are off, and a price change voids the token", async () => {
    const source = photo("tent-3");
    const id = await product([source]);
    const key = await apiKey({ confirmSensitive: false });

    const refusal = await rejects(
      products("enhanceImage", { id, imageUrl: source }, key()),
      "CONFIRMATION_REQUIRED",
    );
    const token = refusal.data.details?.confirmationToken as string;
    fake.state.quote = { ...fake.state.quote, priceMicro: 3_000_000 };
    await rejects(
      products("enhanceImage", { id, imageUrl: source }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 0);
  });

  test("a free run asks no one, and charges nothing", async () => {
    fake.state.quote = { available: true, priceMicro: 0, credits: null };
    const source = photo("tent-4");
    const id = await product([source]);
    const key = await apiKey();

    const started = await products("removeImageBackground", { id, imageUrl: source }, key());
    assert.equal(started.kind, "product_image_remove_background");
    assert.equal(started.priceCredits, 0);
    await images.runImageJob(started.id, ports);
    const done = await getJob({ id: started.id }, key());
    assert.equal(done.status, "succeeded");
    assert.equal(done.result?.creditsCharged, 0);
    assert.match(done.result?.url ?? "", /-bg\.webp$/);
    assert.equal((await debits()).length, 0);
  });

  test("the same photo again returns its running job, without asking or charging again", async () => {
    const source = photo("tent-5");
    const id = await product([source]);
    const first = await products("enhanceImage", { id, imageUrl: source }, session());
    const key = await apiKey();

    const again = await products("enhanceImage", { id, imageUrl: source }, key());
    assert.equal(again.id, first.id);
    await rejects(
      products("removeImageBackground", { id, imageUrl: source }, key()),
      "IMAGE_JOB_RUNNING",
    );
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 1);
  });

  test("an idempotency key replays the job it started", async () => {
    const source = photo("tent-6");
    const id = await product([source]);
    const key = await apiKey({ confirmSensitive: false });
    const refusal = await rejects(
      products("enhanceImage", { id, imageUrl: source }, key()),
      "CONFIRMATION_REQUIRED",
    );
    const headers = {
      "louez-confirmation": refusal.data.details?.confirmationToken as string,
      "idempotency-key": "photo-1",
    };
    const first = await products("enhanceImage", { id, imageUrl: source }, key(headers));
    const replay = await products("enhanceImage", { id, imageUrl: source }, key(headers));
    assert.equal(replay.id, first.id);
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 1);
  });

  test("refuses before any preview what cannot run", async () => {
    const source = photo("tent-7");
    const id = await product([source, photo("done-ai").replace(".png", "-ai.webp")]);
    const key = await apiKey();

    await rejects(
      products("enhanceImage", { id, imageUrl: photo("elsewhere") }, key()),
      "IMAGE_NOT_ON_PRODUCT",
    );
    await rejects(
      products("enhanceImage", { id, imageUrl: `${FILES}/${STORE}/products/done-ai-ai.webp` }, key()),
      "IMAGE_ALREADY_PROCESSED",
    );
    await rejects(
      products("enhanceImage", { id: "nope", imageUrl: source }, key()),
      "PRODUCT_NOT_FOUND",
    );
    fake.state.quote = { ...fake.state.quote, credits: { allowed: false, monthlyRemainingMicro: 0, prepaidMicro: 0 } };
    const exhausted = await rejects(
      products("enhanceImage", { id, imageUrl: source }, key()),
      "AI_CREDITS_EXHAUSTED",
    );
    assert.match(String(exhausted.data.details?.rechargeUrl), /\/dashboard\/ai-credits\?recharge=1/);
    fake.state.quote = { ...fake.state.quote, available: false };
    await rejects(
      products("enhanceImage", { id, imageUrl: source }, key()),
      "AI_IMAGE_UNAVAILABLE",
    );
    assert.equal(await louezDb.db.$count(louezDb.apiConfirmations), 0);
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 0);
  });

  test("a photo Louez does not store for the store cannot be processed", async () => {
    // A product of another store's folder, set through the database.
    const id = await product([photo("ok")]);
    const foreign = photo("theirs", OTHER_STORE);
    await louezDb.db
      .update(louezDb.products)
      .set({ images: [foreign] })
      .where(orm.eq(louezDb.products.id, id));
    await rejects(
      products("enhanceImage", { id, imageUrl: foreign }, session()),
      "IMAGE_NOT_PROCESSABLE",
    );
  });

  test("at most three photos of a store run at once", async () => {
    const urls = ["a", "b", "c", "d"].map((name) => photo(`busy-${name}`));
    const id = await product(urls);
    for (const url of urls.slice(0, 3)) {
      await products("enhanceImage", { id, imageUrl: url }, session());
    }
    await rejects(
      products("enhanceImage", { id, imageUrl: urls[3] }, session()),
      "IMAGE_JOBS_BUSY",
    );
  });

  test("a product keeps the versions of 20 photos at most, those of removed photos included", async () => {
    const shown = photo("full-shown");
    const id = await product([shown]);
    // Lineages of 20 photos the product no longer shows: their URLs are gone from `images`.
    await louezDb.db
      .update(louezDb.products)
      .set({
        imageHistory: Array.from({ length: 20 }, (_, index) => ({
          id: `h${index}`,
          versions: [{ id: `v${index}`, url: photo(`gone-${index}`), kind: "original" as const }],
        })),
      })
      .where(orm.eq(louezDb.products.id, id));
    const refusal = await rejects(
      products("enhanceImage", { id, imageUrl: shown }, session()),
      "IMAGE_HISTORY_FULL",
    );
    assert.equal(refusal.data.details?.max, 20);
  });

  test("six photos without a history start, one more than the former cap of five", async () => {
    const urls = ["a", "b", "c", "d", "e", "f"].map((name) => photo(`six-${name}`));
    const id = await product(urls);
    await louezDb.db
      .update(louezDb.products)
      .set({
        imageHistory: urls.slice(0, 5).map((url, index) => ({
          id: `h${index}`,
          versions: [{ id: `v${index}`, url, kind: "original" as const }],
        })),
      })
      .where(orm.eq(louezDb.products.id, id));
    const started = await products("enhanceImage", { id, imageUrl: urls[5] ?? "" }, session());
    await images.runImageJob(started.id, ports);
    assert.equal((await productRow(id))?.imageHistory?.length, 6);
    // The dashboard's update, which runs the form's rules, still saves it.
    await products("update", { id, name: "Tente 6 photos" }, session());
  });

  // --- Failures and recovery --------------------------------------------------

  test("a provider outage runs again once, then fails: nothing charged, the file dropped, the inbox told", async () => {
    const { ProductImageFailure } = await import("../../platform/ports");
    const source = photo("tent-8");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());

    fake.state.failNext = new ProductImageFailure("PROVIDER_ERROR", "down", true);
    await images.runImageJob(started.id, ports);
    let row = await jobRow(started.id);
    assert.equal(row?.status, "queued");
    assert.equal(row?.attempts, 1);
    assert.equal(row?.activeSlot, 1);
    const waiting = await getJob({ id: started.id }, session());
    assert.match(waiting.summary, /runs again/);
    assert.equal(waiting.error, null);

    // Not due yet: the cron leaves it.
    assert.deepEqual(await jobs.dueJobIds(), []);
    await makeDue(started.id);
    assert.deepEqual(await jobs.dueJobIds(), [started.id]);
    fake.state.failNext = new ProductImageFailure("PROVIDER_ERROR", "down", true);
    await images.runImageJob(started.id, ports);
    row = await jobRow(started.id);
    assert.equal(row?.status, "failed");
    assert.equal(row?.error?.code, "PROVIDER_ERROR");
    assert.equal(row?.activeSlot, null);
    assert.equal((await debits()).length, 0);
    assert.deepEqual(fake.state.discarded, [images.imageJobKey(STORE, started.id, "enhance")]);
    assert.deepEqual((await productRow(id))?.images, [source]);

    // The inbox shows an item once it is 30 seconds old.
    await louezDb.db
      .update(louezDb.apiJobs)
      .set({ finishedAt: orm.sql`NOW(3) - INTERVAL 1 MINUTE` })
      .where(orm.eq(louezDb.apiJobs.id, started.id));
    const listed = await inbox(session());
    const item = listed.items.find((entry) => entry.type === "image_job_failed");
    assert.ok(item, "the failed job is in the inbox");
    assert.match(item.summary, /AI enhancement of a photo of "Tente 4 places" failed/);
    assert.deepEqual(item.tools, ["jobs_get", "products_enhance_image"]);

    // Starting the photo again replaces the inbox item.
    await products("enhanceImage", { id, imageUrl: source }, session());
    const later = await inbox(session());
    assert.equal(
      later.items.some((entry) => entry.type === "image_job_failed"),
      false,
    );
  });

  test("an empty result fails at once", async () => {
    const { ProductImageFailure } = await import("../../platform/ports");
    const source = photo("tent-9");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    fake.state.failNext = new ProductImageFailure("IMAGE_EMPTY", "empty", false);
    await images.runImageJob(started.id, ports);
    const done = await getJob({ id: started.id }, session());
    assert.equal(done.status, "failed");
    assert.equal(done.error?.code, "IMAGE_EMPTY");
    assert.equal(done.error?.retryable, false);
    assert.match(done.summary, /Nothing was charged/);
  });

  test("a runner that died is taken over once its lease ends, and the store pays once", async () => {
    const source = photo("tent-10");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());

    // A first runner claims it, then its process dies.
    const first = await jobs.claimJob(started.id);
    assert.equal(first?.kind, "claimed");
    assert.equal(await jobs.claimJob(started.id), null, "a held job is not taken");
    assert.deepEqual(await jobs.dueJobIds(), []);
    await expireLease(started.id);
    assert.deepEqual(await jobs.dueJobIds(), [started.id]);

    await images.runImageJob(started.id, ports);
    assert.equal((await jobRow(started.id))?.status, "succeeded");
    assert.equal((await jobRow(started.id))?.attempts, 2);
    assert.equal((await debits()).length, 1);

    // The first runner, back late, holds nothing.
    const stale = await louezDb.db.transaction((tx) =>
      jobs.lockClaimedJob(tx, started.id, first?.kind === "claimed" ? first.token : ""),
    );
    assert.equal(stale, false);
  });

  test("a job past its last attempt is abandoned, its file dropped", async () => {
    const source = photo("tent-11");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    for (let run = 0; run < 2; run += 1) {
      await jobs.claimJob(started.id);
      await expireLease(started.id);
    }
    await images.runImageJob(started.id, ports);
    const row = await jobRow(started.id);
    assert.equal(row?.status, "failed");
    assert.equal(row?.error?.code, "JOB_ABANDONED");
    assert.equal(row?.activeSlot, null);
    assert.deepEqual(fake.state.discarded, [images.imageJobKey(STORE, started.id, "enhance")]);
    assert.equal((await debits()).length, 0);
  });

  test("a photo removed meanwhile is not charged, and its result is dropped", async () => {
    const source = photo("tent-12");
    const id = await product([photo("cover-12"), source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    await products("update", { id, images: [photo("cover-12")] }, session());

    await images.runImageJob(started.id, ports);
    const done = await getJob({ id: started.id }, session());
    assert.equal(done.status, "failed");
    assert.equal(done.error?.code, "IMAGE_NO_LONGER_ON_PRODUCT");
    assert.equal((await debits()).length, 0);
    assert.deepEqual(fake.state.discarded, [images.imageJobKey(STORE, started.id, "enhance")]);
  });

  test("a debit that fails writes nothing; the retry puts the result on and charges once", async () => {
    const source = photo("tent-13");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());

    fake.state.debitFailsNext = true;
    await images.runImageJob(started.id, ports);
    assert.equal((await jobRow(started.id))?.status, "queued");
    assert.deepEqual((await productRow(id))?.images, [source]);
    assert.equal((await debits()).length, 0);
    assert.deepEqual(fake.state.discarded, [], "the file stays for the retry");

    await makeDue(started.id);
    await images.runImageJob(started.id, ports);
    assert.equal((await jobRow(started.id))?.status, "succeeded");
    assert.equal((await debits()).length, 1);
    assert.equal((await productRow(id))?.images?.[0], `${FILES}/${images.imageJobKey(STORE, started.id, "enhance")}`);
  });

  test("a version picked meanwhile is replaced in the same place", async () => {
    const source = photo("tent-14");
    const id = await product([source]);
    const first = await products("removeImageBackground", { id, imageUrl: source }, session());
    await images.runImageJob(first.id, ports);
    const cutOut = `${FILES}/${images.imageJobKey(STORE, first.id, "remove-background")}`;
    // The background-free result may still be enhanced.
    const second = await products("enhanceImage", { id, imageUrl: cutOut }, session());
    // Meanwhile the user goes back to the original.
    await products("useImageVersion", { id, versionId: first.source.versionId }, session());

    await images.runImageJob(second.id, ports);
    const row = await productRow(id);
    assert.deepEqual(row?.images, [`${FILES}/${images.imageJobKey(STORE, second.id, "enhance")}`]);
    assert.equal(row?.imageHistory?.length, 1);
    assert.equal(row?.imageHistory?.[0]?.versions.length, 3);
  });

  // --- Versions ---------------------------------------------------------------

  test("an agent undoes an enhancement with the original's version, and back", async () => {
    const source = photo("tent-15");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    await images.runImageJob(started.id, ports);
    const key = await apiKey();
    events.length = 0;

    const undone = await products(
      "useImageVersion",
      { id, versionId: started.source.versionId },
      key(),
    );
    assert.deepEqual(undone.images, [source]);
    assert.equal(undone.imageVersions[0]?.versions[0]?.current, true);
    assert.equal(events.length, 1);

    const again = await products("useImageVersion", { id, versionId: started.source.versionId }, key());
    assert.deepEqual(again.images, [source]);
    assert.equal(events.length, 1, "using the version in use changes nothing");

    const redone = await products(
      "useImageVersion",
      { id, versionId: `product-image-version-${started.id}` },
      key(),
    );
    assert.match(redone.images[0] ?? "", /-ai\.webp$/);
    await rejects(
      products("useImageVersion", { id, versionId: "missing" }, key()),
      "IMAGE_VERSION_NOT_FOUND",
    );
  });

  // --- Reading ------------------------------------------------------------------

  test("jobs_get waits for the end, keeps to the store, and needs products read", async () => {
    const source = photo("tent-16");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());

    let slept = 0;
    const view = await jobsService.getJob(
      { storeId: STORE, id: started.id, waitSeconds: 10 },
      {
        urls: ports.urls,
        store: { id: STORE, slug: "pi-store-a", onboardingCompleted: true },
        authorize: () => {},
        sleep: async () => {
          slept += 1;
          if (slept === 2) await images.runImageJob(started.id, ports);
        },
      },
    );
    assert.equal(view.status, "succeeded");
    assert.equal(slept, 2, "it stops waiting once the job ended");

    await rejects(getJob({ id: started.id }, session(OTHER_STORE)), "JOB_NOT_FOUND");
    const blind = await apiKey({ products: "none" });
    await rejects(getJob({ id: started.id }, blind()), "PERMISSION_DENIED");
    await rejects(getJob({ id: started.id, waitSeconds: 26 }, session()), "BAD_REQUEST");
  });

  test("the cron leaves a fresh job to its first dispatch, and prunes old ended jobs", async () => {
    const source = photo("tent-17");
    const id = await product([source]);
    const started = await products("enhanceImage", { id, imageUrl: source }, session());
    assert.deepEqual(await jobs.dueJobIds(), [], "within its grace");

    await images.runImageJob(started.id, ports);
    await louezDb.db
      .update(louezDb.apiJobs)
      .set({ finishedAt: orm.sql`NOW(3) - INTERVAL 91 DAY` })
      .where(orm.eq(louezDb.apiJobs.id, started.id));
    assert.equal(await jobs.pruneJobs(), 1);
    assert.equal(await louezDb.db.$count(louezDb.apiJobs), 0);
  });
});
