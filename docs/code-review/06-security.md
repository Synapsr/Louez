# Code Review — Security

> Applies when: auth logic, API routes, or user input handling is changed.

## Rules

### [SE-01] Every API route checks authentication

No public-by-accident routes. If a route is intentionally public, it must be explicitly marked and documented. All other routes verify the session via Better Auth middleware.

### [SE-02] Authorization is resource-level

Checking that a user is authenticated is not enough. Verify they have permission to access/modify the specific resource using the permissions system (`currentUserHasPermission()`). Customer sessions use separate auth from admin sessions.

### [SE-03] Validate all external input

Every piece of data from outside the system (request body, query params, URL params, form data) is validated with Zod before use. No exceptions.

### [SE-04] No secrets in client code

Environment variables used on the client must be prefixed (`NEXT_PUBLIC_`). Server-only secrets must never appear in client bundles. If in doubt, check the build output.

### [SE-05] Multi-tenant isolation

Always filter by `storeId` in database queries to prevent cross-tenant data access. This is the primary security boundary for the multi-tenant architecture.

### [SE-06] SQL injection prevention

Always use Drizzle's parameterized queries. Never interpolate user input into raw SQL strings.

### [SE-07] XSS prevention

Never use `dangerouslySetInnerHTML` unless the content is sanitized. Prefer rendering text content directly — React escapes it automatically.

### [SE-08] Rate limiting on sensitive endpoints

Auth endpoints (login, register, password reset) and any endpoint that sends emails must have rate limiting.

### [SE-09] File uploads are validated

Uploaded files must be checked for: type (MIME + extension), size (enforce max), and content (don't trust the MIME header alone when security-critical).

---

## Related

- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Better Auth setup, oRPC `authed` middleware
- [04-data-layer.md](04-data-layer.md) — oRPC input validation, error handling at route boundaries
- [02-typescript.md](02-typescript.md) — Zod schemas for system boundaries
- [from-scratch/01-monorepo-setup.md](../from-scratch/01-monorepo-setup.md) — Env validation (secrets isolation server vs client)
