# Contributing to Louez

Thanks for wanting to improve Louez. Bug reports, documentation fixes, translations
and features are all welcome.

## License and sign-off

Louez is licensed under the **GNU AGPLv3** (see [LICENSE](LICENSE)). Contributions
are accepted under the same license — there is no separate copyright assignment and
no CLA to sign.

Instead, every commit must carry a **Developer Certificate of Origin** sign-off,
which certifies you have the right to submit the code under the project's license.
Add it with `git commit -s`, which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and an address you can be reached at. The full text of the DCO
you are certifying is in [DCO](DCO); it is the standard version 1.1 used by the
Linux kernel and many other projects.

## Before you open a pull request

1. **Open an issue first** for anything larger than a bug fix or a typo. It saves
   you from building something that doesn't fit the roadmap.
2. **Run the checks.** They are the same ones CI runs:

   ```bash
   pnpm check          # oxlint + duplicate audit + type-check across the monorepo
   pnpm format:check   # formatting
   ```

3. **Follow the review checklist** in
   [docs/code-review/07-checklist.md](docs/code-review/07-checklist.md). It is the
   condensed version of every convention in `docs/code-review/`, organised by the
   domain your diff touches (structure, TypeScript, React, data layer, forms,
   styling, security). Check only the sections that apply.
4. **Keep pull requests focused.** One concern per PR reviews far faster than a
   mixed bag.

## Development setup

Node 22 or later and pnpm 10 are required.

```bash
pnpm install
cp .env.example .env      # then fill in the values you need
pnpm db:migrate:run       # apply the schema
pnpm dev:web              # http://localhost:3000
```

The full configuration surface is documented in [.env.example](.env.example). Most
features degrade gracefully when their variables are absent — you do not need
Stripe, SMTP or AI keys to work on the dashboard.

## Commit messages

Conventional Commits, matching the existing history:

```
feat(reservations): accept requests from mobile actions
fix(checkout): prevalidate advance notice
docs(license): complete the AGPL relicense
```

## Translations

Louez ships in 8 languages: `en`, `fr`, `de`, `es`, `it`, `nl`, `pl`, `pt`. Message
files live in `apps/web/messages/*.json`. When you add a user-facing string, add the
key to **every** locale file — an untranslated key is better than a missing one.

## Third-party assets

The dashboard uses [Nucleo](https://nucleoapp.com) icons, which are **not** covered
by the AGPL and require a valid Nucleo license. Two rules follow:

- Never copy Nucleo SVG sources into the repository. They are consumed at install
  time from the official `nucleo-glass` npm package.
- Every icon must be re-exported from `packages/ui/src/icons/glass.tsx` so the total
  stays auditable and below 100.

Attributions for `rembg` (MIT) and the DIS/IS-Net model (Apache 2.0) are recorded in
[NOTICE](NOTICE). Add any new third-party dependency with a non-permissive license
to that file, and check it is compatible with the AGPL before introducing it.

## Security

Do not open a public issue for a vulnerability. Report it privately as described in
[SECURITY.md](SECURITY.md).
