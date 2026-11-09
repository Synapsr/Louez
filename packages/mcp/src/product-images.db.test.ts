import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";

import type { ApiPorts } from "@louez/api";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestProductImages } from "@louez/api/platform/test-product-images";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// The AI photo tools and jobs_get through the app's real router and the real
// MCP and OpenAPI handlers: the same answers and error codes on both, the
// confirmation every agent gets before credits are spent, and the undo. The
// pipeline is a fake: no provider is called.

const OWNER = "pj_owner_user_000001";
const STORE = "pj_store_a_000000001";
const FILES = "https://files.louez.test";
const SOURCE = `${FILES}/${STORE}/products/tent.png`;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("AI photo tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let runJob: typeof import("@louez/api/services/jobs").runJob;
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let connect: (authorization: string) => Promise<Client>;

  let fake = createTestProductImages(FILES);
  const dispatched: string[] = [];
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
    afterCommit: () => {},
    get productImages() {
      return fake.port;
    },
  };

  before(async () => {
    database = await createTestDatabase("api_photo_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    ({ runJob } = await import("@louez/api/services/jobs"));
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest, routeBodyLimits } =
      await import("@louez/api/platform/openapi");
    const { handleMcpRequest } = await import("./transports/http");
    exposure = createExposure(appRouter);

    const openApiHandler = createOpenApiHandler(exposure.router, { docs: false });
    openApi = async (method, path, body, headers) =>
      (await handleOpenApiRequest(
        openApiHandler,
        new Request(
          `http://louez.test/api/v1${path}`,
          body
            ? {
                method,
                headers: { "content-type": "application/json", ...headers },
                body: JSON.stringify(body),
              }
            : { method, headers },
        ),
        { ports, bodyLimits: routeBodyLimits(exposure.procedures) },
      )) ?? new Response(null, { status: 404 });

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: { insertRecordedPayment: async () => undefined },
    };
    connect = async (authorization: string) => {
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      return mcp;
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@pj.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Brest Camping",
      slug: "pj-brest-camping",
      onboardingCompleted: true,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    fake = createTestProductImages(FILES);
    dispatched.length = 0;
    await louezDb.db.delete(louezDb.apiJobs);
    await louezDb.db.delete(louezDb.products);
  });

  /** A key whose confirmations are off: spending credits still asks. */
  async function key() {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Photo agent",
      permissions: {
        reservations: "read",
        products: "write",
        customers: "none",
        categories: "read",
        payments: "none",
        analytics: "none",
        settings: "read",
      },
    });
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ confirmSensitive: false })
      .where(eq(louezDb.apiKeys.id, created.id));
    return `Bearer ${created.key}`;
  }

  async function product() {
    const [row] = await louezDb.db
      .insert(louezDb.products)
      .values({
        storeId: STORE,
        name: "Tente 4 places",
        price: "30",
        pricingMode: "day",
        status: "active",
        images: [SOURCE],
      })
      .$returningId();
    assert.ok(row);
    return row.id;
  }

  async function withClient<T>(authorization: string, run: (mcp: Client) => Promise<T>) {
    const mcp = await connect(authorization);
    try {
      return await run(mcp);
    } finally {
      await mcp.close();
    }
  }

  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };
  const errorOf = (result: ToolResult) => {
    assert.equal(result.isError, true);
    return (result.structuredContent as { error: { code: string; details?: Json } }).error;
  };

  test("the tools are in the catalog bundle, say how to undo, and the instructions say to show before and after", async () => {
    const names = exposure.procedures
      .filter((entry) =>
        [
          "dashboard.products.enhanceImage",
          "dashboard.products.removeImageBackground",
          "dashboard.products.useImageVersion",
          "dashboard.jobs.get",
        ].includes(entry.path),
      )
      .map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle])
      .sort();
    assert.deepEqual(names, [
      ["jobs_get", "catalog"],
      ["products_enhance_image", "catalog"],
      ["products_remove_image_background", "catalog"],
      ["products_use_image_version", "catalog"],
    ]);

    const { tools, instructions } = await withClient(await key(), async (mcp) => ({
      tools: (await mcp.listTools()).tools,
      instructions: mcp.getInstructions() ?? "",
    }));
    for (const name of ["products_enhance_image", "products_remove_image_background"]) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      assert.match(description, /the result replaces the photo on the product/);
      assert.match(description, /products_use_image_version with the job's source\.versionId puts it back/);
      assert.match(description, /before \(source\.url\)[^.]*after \(result\.url\)/);
      assert.match(description, /always answers CONFIRMATION_REQUIRED/);
    }
    assert.match(instructions, /the before and after images to show the user/);
    assert.match(instructions, /To undo, products_use_image_version takes the original's id/);
    assert.match(instructions, /jobs_get with the job's id/);
  });

  test("an agent confirms the price, follows the job on both transports, and undoes it", async () => {
    const id = await product();
    const authorization = await key();

    // MCP: the first call previews, even with confirmations off.
    const previewed = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: { id, imageUrl: SOURCE } }),
    );
    const refusal = errorOf(previewed);
    assert.equal(refusal.code, "CONFIRMATION_REQUIRED");
    // OpenAPI answers the same.
    const viaOpenApi = await openApi(
      "POST",
      `/products/${id}/images/enhance`,
      { imageUrl: SOURCE },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 412);
    assert.equal(((await viaOpenApi.json()) as { data: Json }).data.code, "CONFIRMATION_REQUIRED");

    const started = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({
          name: "products_enhance_image",
          arguments: {
            id,
            imageUrl: SOURCE,
            confirmationToken: refusal.details?.confirmationToken as string,
          },
        }),
      ),
    ) as Json & { id: string; source: { url: string; versionId: string } };
    assert.equal(started.status, "queued");
    assert.equal(started.source.url, SOURCE);
    assert.deepEqual(dispatched, [started.id]);

    await runJob(started.id, ports);

    const viaMcp = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({ name: "jobs_get", arguments: { id: started.id } }),
      ),
    ) as Json & { result: { url: string; creditsCharged: number } };
    assert.equal(viaMcp.status, "succeeded");
    assert.equal(viaMcp.result.creditsCharged, 2);
    const read = await openApi("GET", `/jobs/${started.id}`, null, { authorization });
    assert.equal(read.status, 200);
    const body = (await read.json()) as Json & { result: { url: string } };
    assert.equal(body.status, "succeeded");
    assert.equal(body.result.url, viaMcp.result.url);

    // Undo over OpenAPI: the original is back on the product.
    const undone = await openApi(
      "POST",
      `/products/${id}/images/use-version`,
      { versionId: started.source.versionId },
      { authorization },
    );
    assert.equal(undone.status, 200);
    assert.deepEqual(((await undone.json()) as { images: string[] }).images, [SOURCE]);

    // A job of another store is not found, on both transports.
    const missing = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "jobs_get", arguments: { id: "nope" } }),
    );
    assert.equal(errorOf(missing).code, "JOB_NOT_FOUND");
    assert.equal((await openApi("GET", "/jobs/nope", null, { authorization })).status, 404);
  });

  test("a refusal has the same code on both transports", async () => {
    const id = await product();
    const authorization = await key();
    const other = `${FILES}/${STORE}/products/other.png`;
    const viaMcp = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "products_remove_image_background", arguments: { id, imageUrl: other } }),
    );
    assert.equal(errorOf(viaMcp).code, "IMAGE_NOT_ON_PRODUCT");
    const viaOpenApi = await openApi(
      "POST",
      `/products/${id}/images/remove-background`,
      { imageUrl: other },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 400);
    assert.equal(((await viaOpenApi.json()) as { data: Json }).data.code, "IMAGE_NOT_ON_PRODUCT");
  });
});
