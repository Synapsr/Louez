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

const assertSuccessfulDeletion = async (response: Response, provider: string): Promise<void> => {
  if (response.ok || response.status === 404) return;

  const body = (await response.text()).slice(0, 500);
  throw new Error(
    `${provider} user deletion failed (${response.status})${body ? `: ${body}` : ""}`,
  );
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
    await assertSuccessfulDeletion(response, "PostHog");
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
  const url = `${withoutTrailingSlash(input.apiUrl)}/api/v1/${encodeURIComponent(input.projectKey)}/users/${encodeURIComponent(input.userId)}`;
  const response = await fetchImplementation(url, {
    method: "DELETE",
    headers: {
      Authorization: input.organizationApiKey,
      "Content-Type": "application/json",
    },
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
    `https://api.gleap.io/v3/projects/users/${encodeURIComponent(input.userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.apiToken}` },
    },
  );

  await assertSuccessfulDeletion(response, "Gleap");
};
