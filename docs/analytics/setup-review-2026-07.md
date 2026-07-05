# Revue du setup analytics — juillet 2026

Etat des lieux du projet PostHog (`Louez.io` / `Default project` / id `118395`) au 2026-07-02, decisions prises, et roadmap des manques restants. A relire quand un point de la roadmap est traite.

## Ce qui est en place

- Client posthog-js sur `app.louez.io` : reverse proxy `/ingest`, pageviews manuels (App Router), identify (`user.id`, email, name), autocapture, session replay (retention 30j), web vitals, heatmaps, opt-out en dev.
- Client posthog-node cote serveur : events `core_product` (onboarding, produits, reservations, devis, paiements) et referral, tous avec `store_id`, montants en cents, `analytics_area` / `feature` / `surface` / `analytics_version`.
- Dashboards : [Louez Activation & Revenue](https://eu.posthog.com/project/118395/dashboard/787983), [Louez Core Metrics](https://eu.posthog.com/project/118395/dashboard/768690), [Louez Referral Program](https://eu.posthog.com/project/118395/dashboard/768585).
- Filtre comptes de test (localhost), coche par defaut sur les nouveaux insights depuis le 2026-07-02.

## Changements appliques le 2026-07-02

Config projet PostHog :

- `autocapture_exceptions_opt_in: true` — les exceptions JS remontent dans Error tracking.
- `capture_dead_clicks: true` — dead clicks captures en plus des rage clicks.
- `base_currency: EUR` (projet + revenue analytics), etait USD.
- `primary_dashboard` -> Louez Core Metrics (etait le dashboard d'exemple).
- `business_model: b2b`, `product_description` renseignee (contexte pour les agents IA PostHog).
- `app_urls: ["https://app.louez.io"]` — autorise la toolbar/heatmaps.

Instrumentation code (`apps/web`) :

- `quote_accepted` / `quote_declined` emis depuis le compte client (`account/reservations/[reservationId]/actions.ts`).
- `checkout_payment_started` emis aussi depuis `createReservationPaymentSession` (compte client, `source` = `account_page` | `quote_acceptance`). C'etait le trou principal : toutes les boutiques sont en mode `request`, donc le chemin de paiement reel (acceptation de devis) etait invisible.
- **Fix `/ingest` sur les storefronts** : `proxy.ts` reecrivait `/ingest/*` vers `/{slug}/ingest/*` sur les sous-domaines boutique, donc chaque appel posthog-js storefront finissait en 404. `/ingest` passe maintenant en pass-through comme `/api` — c'est la cause racine du "zero pageview storefront".
- **Config storefront exemptee de consentement** (`instrumentation-client.ts`) : init host-aware. Dashboard (`app.{domaine}`) = config complete (cookies scoped au host via `cross_subdomain_cookie: false`, replay, autocapture). Storefronts (`{slug}.{domaine}`) et pages marketing = mesure d'audience exemptee CNIL : `persistence: memory` (aucun cookie/localStorage), events anonymes (`person_profiles: identified_only`), pas d'autocapture, pas de replay, pas de heatmaps, pas de dead clicks, pas de surveys. Super props `surface` (`storefront` | `marketing`) et `store_slug` enregistrees a chaque chargement. **Elargir une de ces options cote storefront = banniere de consentement obligatoire.**
- **Surface dashboard explicite** (`instrumentation-client.ts`) : a partir du prochain deploy apres le 2026-07-03, les pageviews dashboard portent aussi `surface: dashboard`. Les pageviews dashboard historiques restent souvent `surface = unknown`.

## Roadmap des manques (prioritee)

1. ~~**Storefront invisible dans PostHog**~~ — resolu le 2026-07-02 (fix `/ingest` + config exemptee, voir ci-dessus). Restes a decider : (a) le funnel visiteur anonyme -> `checkout_reservation_created` ne se stitch pas (client anonyme vs `customer.id` serveur) — ajouter un event client `checkout_submitted` ou passer le distinct id anonyme au serveur si on veut le funnel complet ; (b) `/api/track` (MySQL) coexiste avec PostHog — decider a terme si on garde les deux ou si PostHog devient la source unique cote storefront.
2. **Group analytics (boutiques)** — `store_id` existe sur tous les events serveur mais aucun `groupIdentify`. Ajouter le group type `store` permettrait des metriques "par boutique" natives (WAU boutiques, funnels agreges par store, cohortes de stores). Prerequis pour de vraies metriques B2B.
3. **Feature flags / experiments** — aucun flag defini, aucun usage SDK. A brancher au premier besoin d'A/B test ou de rollout progressif (le champ `$feature/*` est deja capture par le SDK).
4. **Events cycle de vie reservation** — pas d'event annulation, completion, remboursement. Le statut n'existe qu'a la creation. Empeche de mesurer churn de reservation et taux d'annulation.
5. **Signup / login** — aucun event explicite ; `$identify` sert de proxy. Un event `user_signed_up` rendrait les funnels d'acquisition fiables.
6. **Subscription / billing SaaS** — les events Stripe d'abonnement Louez (upgrade, churn marchand) ne sont pas traces dans PostHog.
7. **Revenue analytics PostHog** — `revenue_analytics_config.events` est vide ; brancher `checkout_payment_completed` (`amount_cents`) donnerait les vues revenue natives.
8. **Masking session replay** — `maskAllInputs: false` alors que le dashboard manipule des donnees clients (emails, telephones). A restreindre (masquer les inputs sensibles) avant d'elargir l'usage des replays PostHog.
9. **Referral serveur jamais ingere** — `referral_invite_landed`, `referral_reward_granted`, `referral_qualifying_payment_evaluated`, clawbacks : 0 event. Coherent avec l'absence de rewards accordes a date, mais a verifier au premier reward reel.

## Pieges connus (a ne pas redecouvrir)

- `/ingest` doit rester en pass-through dans `proxy.ts` : si le proxy le reecrit vers `/{slug}/ingest`, tout le tracking client storefront meurt en 404 silencieux (posthog-js ne log rien).
- Sur les storefronts, la persistence est `memory` : le visiteur change de distinct id a chaque rechargement complet de page (la navigation SPA conserve l'id). Les funnels storefront sont donc intra-session/intra-onglet uniquement, et les comptes "visiteurs uniques" storefront surestiment la realite.
- `checkout_payment_completed` porte `amount_cents`, pas `total_amount_cents` : les sommes de revenue doivent utiliser `amount_cents`.
- Deux streams d'identite : marchand (`user.id` / `store.userId`) et client final (`customer.id`). Un funnel qui melange les deux ne convertit jamais.
- `payment_ready` sur `checkout_reservation_created` signifie "Stripe branche", pas "paiement lance" : le paiement inline exige en plus `reservationMode = payment`.
- Les insights du dashboard Referral referencent des events pas encore ingeres ; cartes vides attendues.
