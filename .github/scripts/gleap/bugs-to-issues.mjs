/**
 * Opens one GitHub issue per Gleap BUG ticket and links both ways: the issue
 * links the Gleap ticket, the ticket gets the `github-issue` tag (which also
 * stops it from being picked up again) and an internal note with the issue URL.
 *
 * Tickets hold customer data. The issue therefore carries only the Gleap
 * number, priority and link, never the ticket text, and the title only when
 * GLEAP_ISSUES_INCLUDE_TITLE is "true". Point GLEAP_ISSUES_REPO at a private
 * repository: Synapsr/Louez is public.
 *
 *   DRY_RUN=false GLEAP_API_KEY=… GLEAP_PROJECT_ID=… GITHUB_TOKEN=… \
 *   GLEAP_ISSUES_REPO=owner/repo GLEAP_BUGS_SINCE=2026-11-01T00:00:00.000Z \
 *     node .github/scripts/gleap/bugs-to-issues.mjs
 */
import { dryRun, gleap, requireEnv } from "./client.mjs";

const LINKED_TAG = "github-issue";
const repo = requireEnv("GLEAP_ISSUES_REPO");
const project = requireEnv("GLEAP_PROJECT_ID");
const since = requireEnv("GLEAP_BUGS_SINCE");
const includeTitle = process.env.GLEAP_ISSUES_INCLUDE_TITLE === "true";

const query = new URLSearchParams({ type: "BUG", status: "OPEN" });
const answer = await gleap("GET", `/tickets?${query}&createdAt>=${encodeURIComponent(since)}`);
const tickets = Array.isArray(answer) ? answer : (answer?.tickets ?? []);
const pending = tickets.filter((ticket) => !(ticket.tags ?? []).includes(LINKED_TAG));
console.log(
  `${tickets.length} open BUG tickets since ${since}, ${pending.length} without an issue`,
);

async function createIssue(ticket) {
  const link = `https://app.gleap.io/projects/${project}/bugs/${ticket.id}`;
  const title = `Gleap bug #${ticket.bugId}${includeTitle && ticket.title ? `: ${ticket.title}` : ""}`;
  const body = [
    `Reported through Gleap: ${link}`,
    "",
    `- Gleap number: #${ticket.bugId}`,
    `- Priority: ${ticket.priority ?? "MEDIUM"}`,
    "",
    "The report, screenshots and customer conversation stay in Gleap. Do not copy customer data here.",
  ].join("\n");
  if (dryRun) {
    console.log(`[dry run] issue in ${repo}: ${title}`);
    return null;
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, labels: ["bug", "gleap"] }),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}: ${await response.text()}`);
  return (await response.json()).html_url;
}

for (const ticket of pending) {
  const issueUrl = await createIssue(ticket);
  // Tag before the note: if the note fails, the next run still skips this ticket.
  await gleap("PUT", `/tickets/${ticket.id}`, { tags: [...(ticket.tags ?? []), LINKED_TAG] });
  await gleap("POST", "/messages", {
    ticket: ticket.id,
    isNote: true,
    markdownComment: `GitHub issue: ${issueUrl ?? "(dry run)"}`,
  });
  console.log(`#${ticket.bugId} → ${issueUrl ?? "(dry run)"}`);
}
