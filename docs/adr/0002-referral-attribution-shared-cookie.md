# Referral Attribution via a Shared `.louez.io` Cookie

Referral attribution is captured by middleware on **both** the marketing site (`louez.io`, repo `Louez-Website`) and the app (`app.louez.io`, repo `Louez`/`apps/web`), each setting the same `louez_referral` cookie scoped to the parent domain `.louez.io` (30-day max-age, `SameSite=Lax`, last-click wins). Because both surfaces share the `louez.io` registrable domain, a referral captured anywhere on the marketing site survives the navigation to `app.louez.io` and is read at onboarding, where it is frozen onto the new store as `referredByUserId` / `referredByStoreId`. The shared referral link points at `louez.io/?ref=<code>` (the marketing home) rather than the app, so the prospect lands on the best entry page while attribution still carries through.

## Considered Options

- Capture `?ref=` only on the app (status quo: client-side JS on `/login` only). Rejected: loses every prospect who discovers Louez on the marketing site and never carries a code from there.
- Keep the cookie host-only and forward `?ref=` through every marketing CTA into the app URL. Rejected: fragile — one un-instrumented link or redirect drops the attribution.
- Server-side attribution keyed on the authenticated user instead of a cookie. Rejected: the prospect is anonymous when they click the link, well before any account exists.

## Consequences

- Ref capture lives in **two** repositories' middlewares and must stay in sync (cookie name, domain, max-age, validation, last-click semantics). A future reader seeing the duplication should understand it is deliberate, not an oversight.
- The marketing middleware already performs **locale redirects**; the `Set-Cookie` must be attached to the redirect response too, or the code is lost on the `/` → `/<locale>` hop.
- The client-side cookie setter in `use-login-form.ts` becomes redundant and is removed in favour of the app middleware.
- A storefront served on a **custom domain** (an Ultra feature) is outside `.louez.io` and can never share this cookie. This is an accepted, by-construction limitation: referral links are not expected to originate from custom-domain storefronts.
- Attribution is frozen at **onboarding completion**, not at click time, so the 30-day window must cover click → sign-up → onboarding, not just click → sign-up.
