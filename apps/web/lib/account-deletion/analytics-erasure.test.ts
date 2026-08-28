import assert from "node:assert/strict";
import { test } from "node:test";

import { deleteGleapUser, deleteOpenReplayUser, deletePostHogPerson } from "./analytics-erasure";

test("deletes the PostHog person and queues deletion of their events", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: input.toString(),
    });
    if (!init?.method) {
      return Response.json({ results: [{ id: 42 }] });
    }
    return new Response(null, { status: 204 });
  };

  await deletePostHogPerson({
    apiHost: "https://eu.posthog.com/",
    personalApiKey: "phx_secret",
    projectId: "123",
    distinctId: "user-1",
    fetchImplementation,
  });

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://eu.posthog.com/api/projects/123/persons/?distinct_id=user-1",
    },
    {
      method: "DELETE",
      url: "https://eu.posthog.com/api/projects/123/persons/42/?delete_events=true",
    },
  ]);
});

test("treats a missing PostHog person as already deleted", async () => {
  let requestCount = 0;
  await deletePostHogPerson({
    apiHost: "https://eu.posthog.com",
    personalApiKey: "phx_secret",
    projectId: "123",
    distinctId: "user-1",
    fetchImplementation: async () => {
      requestCount += 1;
      return Response.json({ results: [] });
    },
  });

  assert.equal(requestCount, 1);
});

test("rejects a malformed PostHog person response", async () => {
  await assert.rejects(
    deletePostHogPerson({
      apiHost: "https://eu.posthog.com",
      personalApiKey: "phx_secret",
      projectId: "123",
      distinctId: "user-1",
      fetchImplementation: async () => Response.json({ results: [{ id: { unexpected: true } }] }),
    }),
    /Invalid input/,
  );
});

test("uses the OpenReplay organization key without a Bearer prefix", async () => {
  let authorization: string | null = null;
  await deleteOpenReplayUser({
    apiUrl: "https://openreplay.example.com/",
    organizationApiKey: "organization-secret",
    projectKey: "project-key",
    userId: "owner@example.com",
    fetchImplementation: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json({ data: { status: "scheduled" } });
    },
  });

  assert.equal(authorization, "organization-secret");
});

test("accepts a missing Gleap user as an idempotent deletion", async () => {
  await assert.doesNotReject(
    deleteGleapUser({
      apiToken: "gleap-secret",
      userId: "user-1",
      fetchImplementation: async () => new Response("not found", { status: 404 }),
    }),
  );
});
