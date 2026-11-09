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

test("schedules the OpenReplay user deletion on the public API with a Bearer key", async () => {
  const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
  await deleteOpenReplayUser({
    apiUrl: "https://openreplay.example.com/v2/api/",
    organizationApiKey: "organization-secret",
    projectKey: "project-key",
    userId: "owner@example.com",
    fetchImplementation: async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: input.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ data: { status: "scheduled" } });
    },
  });

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://openreplay.example.com/v2/api/public/project-key/users/owner%40example.com",
      authorization: "Bearer organization-secret",
    },
  ]);
});

test("deletes the Gleap contact identified by the Louez user id", async () => {
  const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
  await deleteGleapUser({
    apiToken: "gleap-secret",
    userId: "user-1",
    fetchImplementation: async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: input.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(null, { status: 204 });
    },
  });

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://api.gleap.io/v3/s2s/contacts/user-1",
      authorization: "Bearer gleap-secret",
    },
  ]);
});

test("accepts Gleap's contact-not-found answer as an idempotent deletion", async () => {
  await assert.doesNotReject(
    deleteGleapUser({
      apiToken: "gleap-secret",
      userId: "user-1",
      fetchImplementation: async () =>
        Response.json({ code: "not_found", detail: "Contact not found" }, { status: 404 }),
    }),
  );
});

test("fails on a Gleap 404 that is not a missing contact", async () => {
  await assert.rejects(
    deleteGleapUser({
      apiToken: "gleap-secret",
      userId: "user-1",
      fetchImplementation: async () => new Response("Cannot DELETE /v3/route", { status: 404 }),
    }),
    /Gleap user deletion failed \(404\)/,
  );
});

test("fails on an OpenReplay 404, which only a wrong route or API base returns", async () => {
  await assert.rejects(
    deleteOpenReplayUser({
      apiUrl: "https://openreplay.example.com",
      organizationApiKey: "organization-secret",
      projectKey: "project-key",
      userId: "owner@example.com",
      fetchImplementation: async () => Response.json({ detail: "Not Found" }, { status: 404 }),
    }),
    /OpenReplay user deletion failed \(404\)/,
  );
});
