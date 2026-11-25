# Releasing Louez

A minor release every two weeks, and a patch release whenever a security fix or a regression needs one. The version is the one self-hosters run: the Docker images `synapsr/louez` and `synapsr/louez-background-removal` are published when a `vX.Y.Z` tag is pushed (`.github/workflows/docker.yml`).

## Which number

- **Major**: a self-hoster must act or the instance breaks — an environment variable removed without a fallback, a manual migration step, a breaking change to a stable API.
- **Minor**: features, and migrations the image applies at start-up.
- **Patch**: fixes only.

## Change notes

Every user-visible change ships with a note in `changes/` (see the existing notes):

```markdown
---
type: new # new | added | improved | changed | fixed
---

## The title, in the user's words

What changes for the store, then a "Self-hosting:" paragraph when an operator has something to do.
```

## Steps

1. **Freeze**: pick the last green commit of `main`.
2. **Checks**: CI, the Docker and Compose smoke tests, an upgrade from a database of the previous version (`packages/db/src/docker-migrator.db.test.ts`), and the critical paths by hand on a staging instance: book, pay in Stripe test mode, confirm, contract PDF, customer portal.
3. **Changelog**: `pnpm release:notes X.Y.Z` prints the English section built from `changes/` and from what `[Unreleased]` holds. `pnpm release:notes X.Y.Z --write --archive` adds it to `CHANGELOG.md` and moves the notes to `changes/released/X.Y.Z/`. Write the French section from it, and put any action self-hosters must take at the top.
4. **Approval** by a partner, then the tag `vX.Y.Z` on that commit. CI publishes the images.
5. **GitHub release** with the notes.

## Related

- [support/gleap.md](support/gleap.md) — how the change notes feed support
- [code-review/07-checklist.md](code-review/07-checklist.md)
