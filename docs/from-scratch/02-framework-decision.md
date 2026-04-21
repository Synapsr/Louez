# From Scratch — Framework Decision

## Decision Tree

```
Is the project primarily...

├─ Content/marketing site, blog, SEO-critical pages?
│  └─ Use Next.js (App Router)
│
├─ Server-rendered app with forms, auth, data mutations?
│  └─ Use Next.js (App Router)
│
├─ Client-heavy SPA, dashboard, real-time interactive UI?
│  └─ Use TanStack Start
│
├─ Hybrid (some pages SEO, some pages SPA)?
│  └─ Default to Next.js — it handles both patterns
│
└─ Unsure?
   └─ Use Next.js
```

## Next.js — When and how

**Use when:** SSR/SSG matters, SEO is important, content-heavy, forms with server actions.

Key conventions:
- App Router (not Pages Router)
- Server Components by default, `"use client"` only when needed
- Server Actions for mutations
- Route handlers (`route.ts`) for API endpoints
- Middleware for auth checks and redirects

## TanStack Start — When and how

**Use when:** the UI is an SPA with minimal SEO needs, heavy client interactivity, real-time updates.

Key conventions:
- File-based routing via TanStack Router
- Loaders for data fetching
- Full client-side rendering by default
- React Query for all server state

## Shared patterns regardless of framework

- TypeScript strict mode
- Tailwind CSS for styling
- React Query for server state
- Zustand for client state
- ORPC for type-safe API calls
- Better Auth for authentication
- Drizzle ORM for database access

---

## Related

- [01-monorepo-setup.md](01-monorepo-setup.md) — Monorepo workspace the framework lives inside
- [04-backend.md](04-backend.md) — Backend patterns (mostly framework-agnostic: oRPC, Drizzle, Better Auth)
- [05-frontend.md](05-frontend.md) — Frontend conventions (components, state, forms)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Imposed stack overview
