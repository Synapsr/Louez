import { z } from "zod";

type FetchImplementation = typeof fetch;

const postHogPersonListSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .default([]),
});

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const gleapNotFoundSchema = z.object({ code: z.literal("not_found") });

// A 404 counts as "already deleted" only when the provider says the user is
// gone: a 404 from a wrong route or API base must fail loudly.
const assertSuccessfulDeletion = async (
  response: Response,
  provider: string,
  isAlreadyDeleted: (body: string) => boolean = () => false,
): Promise<void> => {
  if (response.ok) return;

  const body = await response.text();
  if (response.status === 404 && isAlreadyDeleted(body)) return;

  const excerpt = body.slice(0, 500);
  throw new Error(
    `${provider} user deletion failed (${response.status})${excerpt ? `: ${excerpt}` : ""}`,
  );
};

const isGleapContactNotFound = (body: string): boolean => {
  try {
    return gleapNotFoundSchema.safeParse(JSON.parse(body)).success;
  } catch {
    return false;
  }
};

export const deletePostHogPerson = async (input: {
  apiHost: string;
  personalApiKey: string;
  projectId: string;
  distinctId: string;
  fetchImplementation?: FetchImplementation;
}): Promise<void> => {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const baseUrl = `${withoutTrailingSlash(input.apiHost)}/api/projects/${encodeURIComponent(input.projectId)}/persons`;
  const lookupUrl = new URL(`${baseUrl}/`);
  lookupUrl.searchParams.set("distinct_id", input.distinctId);

  const lookupResponse = await fetchImplementation(lookupUrl, {
    headers: { Authorization: `Bearer ${input.personalApiKey}` },
    cache: "no-store",
  });
  if (!lookupResponse.ok) {
    throw new Error(
      `PostHog person lookup failed (${lookupResponse.status}): ${(await lookupResponse.text()).slice(0, 500)}`,
    );
  }

  const payload = postHogPersonListSchema.parse(await lookupResponse.json());
  const personIds = payload.results
    .map((person) => person.id)
    .filter((id): id is string | number => typeof id === "string" || typeof id === "number");

  for (const personId of personIds) {
    const deleteUrl = new URL(`${baseUrl}/${encodeURIComponent(String(personId))}/`);
    deleteUrl.searchParams.set("delete_events", "true");
    const response = await fetchImplementation(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.personalApiKey}` },
    });
    // The lookup above found this person, so a 404 here means it is already gone.
    await assertSuccessfulDeletion(response, "PostHog", () => true);
  }
};

export const deleteOpenReplayUser = async (input: {
  apiUrl: string;
  organizationApiKey: string;
  projectKey: string;
  userId: string;
  fetchImplementation?: FetchImplementation;
}): Promise<void> => {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  // apiUrl is the public API base: https://<instance>/v2/api when self-hosted,
  // https://api.openreplay.com/v2 on OpenReplay Cloud.
  const url = `${withoutTrailingSlash(input.apiUrl)}/public/${encodeURIComponent(input.projectKey)}/users/${encodeURIComponent(input.userId)}`;
  const response = await fetchImplementation(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${input.organizationApiKey}` },
  });

  await assertSuccessfulDeletion(response, "OpenReplay");
};

export const deleteGleapUser = async (input: {
  apiToken: string;
  userId: string;
  fetchImplementation?: FetchImplementation;
}): Promise<void> => {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const response = await fetchImplementation(
    `https://api.gleap.io/v3/s2s/contacts/${encodeURIComponent(input.userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.apiToken}` },
    },
  );

  await assertSuccessfulDeletion(response, "Gleap", isGleapContactNotFound);
};
