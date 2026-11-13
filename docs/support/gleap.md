# Support with Gleap

Louez Cloud support runs on Gleap: the help center at help.louez.io, the chat in the dashboard and Kai, Gleap's support AI. This page explains how the repository feeds it. Nothing here runs until a maintainer turns it on.

## What Kai reads

Kai answers from the published help center articles and from these public sources, kept in sync by `.github/scripts/gleap/sync-kai-sources.mjs`:

| Source                           | Why                                                         |
| -------------------------------- | ----------------------------------------------------------- |
| `README.md`, `README.fr.md`      | Self-hosting, features, license                             |
| `CHANGELOG.md`                   | What changed in each version, so Kai knows the latest state |
| `https://louez.io/llms-full.txt` | The full product reference, including the agents and MCP    |

The script upserts one Gleap AI content entry per source (`PUT /aicontent/{contentId}`), so each run replaces the previous text. It runs on every push to `main` that touches those files, on every published release, and by hand.

The repository itself can also be connected under **Knowledge › Code repositories** in Gleap (the Gleap GitHub App). Hide `docs/plans/`, `.agent-docs/` and anything that is not product behavior.

## Help center drafts

Articles are written in Markdown in `docs/help-center/` (ignored by Git: drafts and audits stay local) and pushed with:

```bash
DRY_RUN=false GLEAP_API_KEY=… GLEAP_PROJECT_ID=… \
  node .github/scripts/gleap/sync-help-center.mjs docs/help-center/articles
```

The script only writes drafts. Publishing stays a click in Gleap.

## Release notes loop

1. Each user-visible change ships with a note in `changes/`; a release turns them into `CHANGELOG.md`.
2. The release triggers the Kai sources sync, so Kai knows the release the minute it is published.
3. A maintainer (or an agent through the Gleap MCP) drafts the Gleap news and updates the "What's new" help center article from the changelog, then reviews and publishes them in Gleap.

## Turning it on

Repository settings › Secrets and variables › Actions:

| Name                    | Kind     | Value                                                                  |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `GLEAP_SUPPORT_ENABLED` | variable | `true` to run the jobs                                                 |
| `GLEAP_DRY_RUN`         | variable | `false` to write; anything else prints what would change               |
| `GLEAP_PROJECT_ID`      | variable | The Gleap project id                                                   |
| `GLEAP_API_KEY`         | secret   | A Gleap API key (Settings › Developer › API keys)                      |
| `GLEAP_AI_CONTENT_TYPE` | variable | The `type` of an AI content entry, read from one made in the dashboard |

Start with the dry run and read the job log before setting `GLEAP_DRY_RUN` to `false`.

## Related

- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [docs/architecture/api-and-agents.md](../architecture/api-and-agents.md)
