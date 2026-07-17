# Core Product Analytics

## Dashboard

- Outil : PostHog
- Projet : `Louez.io` / `Default project` / id `118395`
- Periode par defaut : `-30d` pour le suivi courant, `-90d` pour relire un flux peu frequente
- Dashboards :
  - [Louez Activation & Revenue](https://eu.posthog.com/project/118395/dashboard/787983) : funnels onboarding/checkout, reservations par canal, revenue encaisse, boutiques actives
  - [Louez Core Metrics](https://eu.posthog.com/project/118395/dashboard/768690) : trafic, identification, friction, web vitals

L'instrumentation detaillee du flow onboarding (steps, branding, erreurs, Stripe Connect, canal d'acquisition) est documentee dans [onboarding.md](onboarding.md).

## Role des outils

PostHog est la source pour les evenements produit, funnels, cohorts, web vitals et signaux de friction comme rage clicks, dead clicks et exceptions.

OpenReplay est la source pour les replays de sessions. Les analyses qualitatives de parcours doivent donc pointer vers OpenReplay, pas vers les session recordings PostHog.

## Questions produit

- Combien de stores passent les etapes clefs de l'onboarding ?
- Les marchands creent-ils des produits complets ou abandonnent-ils avant le catalogue ?
- Les reservations creees depuis le dashboard et le storefront aboutissent-elles au bon statut ?
- Le checkout va-t-il jusqu'au paiement Stripe, et ou le funnel se coupe-t-il ?
- Les flux avec livraison, assurance Tulip, paiement partiel ou PAYG ont-ils une conversion differente ?

## Evenements P1

| Evenement                       | Moment d'emission                                  | Distinct id    | Proprietes principales                                                                                                                           |
| ------------------------------- | -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onboarding_store_info_saved`   | Apres sauvegarde de l'etape infos store            | `user.id`      | `store_id`, `country`, `currency`, `is_existing_incomplete_store`, `referral_outcome`, flags de completude                                       |
| `onboarding_completed`          | Quand `onboardingCompleted` passe a `true`         | `store.userId` | `store_id`, `reservation_mode`                                                                                                                   |
| `product_created`               | Apres transaction de creation produit              | `store.userId` | `store_id`, `product_id`, `product_status`, `track_units`, counts images/rates/units, `pricing_mode`                                             |
| `dashboard_reservation_created` | Apres creation d'une reservation back-office       | `store.userId` | `store_id`, `reservation_id`, `customer_id`, statut, counts lignes/quantites, flags livraison/assurance, montants en cents                       |
| `checkout_reservation_created`  | Apres creation d'une reservation storefront        | `customer.id`  | `store_id`, `reservation_id`, `customer_id`, counts, flags livraison/assurance/promo/paiement, montants en cents                                 |
| `checkout_payment_started`      | Apres creation d'une session Stripe Checkout       | `customer.id`  | `store_id`, `reservation_id`, `payment_provider`, `payment_mode`, montants/frais en cents                                                        |
| `checkout_payment_completed`    | Apres reconciliation d'un paiement Stripe complete | `customer.id`  | `store_id`, `reservation_id`, source `stripe_connect_webhook` ou `success_page_verification`, statut avant confirmation, montants/frais en cents |
| `quote_accepted`                | Quand le client accepte un devis (compte client)   | `customer.id`  | `store_id`, `reservation_id`, `reservation_mode`, `catalog_line_count`, montants en cents                                                        |
| `quote_declined`                | Quand le client refuse un devis (compte client)    | `customer.id`  | `store_id`, `reservation_id`, `total_amount_cents`, `currency`                                                                                   |

Note : `checkout_payment_started` est aussi emis depuis le compte client (`feature: customer_account`) quand une session Stripe est creee via `createReservationPaymentSession`, avec `source` = `account_page` ou `quote_acceptance`. Le chemin inline du checkout (`source: storefront_checkout`) ne s'execute que pour les stores en `reservationMode = payment` ; toutes les boutiques actuelles sont en mode `request`, donc le volume vient du compte client.

Les proprietes ne doivent pas contenir de nom client, email, telephone, adresse, nom produit, note libre ou payload Stripe complet. Les IDs internes, montants agreges, counts, flags et statuts sont autorises.

## Signaux de friction

- `Dead click` : clic sur un element qui semble actionnable mais ne produit pas de retour visible utile, comme navigation, mutation DOM, ouverture de menu/modal ou requete pertinente. C'est utile pour trouver des boutons morts, affordances trompeuses ou handlers casses. Le signal peut etre bruite et doit etre recoupe avec OpenReplay.
- `Exception` : erreur runtime capturee par le navigateur ou le serveur, par exemple une exception JavaScript non geree, une erreur React, ou une erreur applicative remontee a l'outil. C'est un signal plus dur qu'un dead click, mais il peut exposer stack traces ou messages sensibles ; l'activation doit etre revue cote privacy avant d'elargir la capture.

## Funnels initiaux

- Onboarding : `onboarding_store_info_saved` -> `onboarding_completed` -> `product_created` — [insight frgZ4fDn](https://eu.posthog.com/project/118395/insights/frgZ4fDn)
- Catalogue marchand : `product_created` -> `dashboard_reservation_created`
- Checkout storefront : `checkout_reservation_created` -> `quote_accepted` (optionnel) -> `checkout_payment_started` (optionnel) -> `checkout_payment_completed` — [insight 1cmroYUG](https://eu.posthog.com/project/118395/insights/1cmroYUG). Toutes les etapes utilisent `customer.id`, le funnel est donc coherent cote identite.
- Paiement sans friction : `checkout_payment_started` -> `checkout_payment_completed`, breakdown par `payment_mode`, `reservation_fee_cents`, `has_tulip_insurance`, `has_delivery`

Attention identite : un funnel `dashboard_reservation_created` (distinct id = `store.userId`) -> `quote_accepted` (distinct id = `customer.id`) ne convertira jamais, les deux etapes appartiennent a des personnes differentes. Les funnels doivent rester dans un seul stream d'identite (marchand ou client).

## Limites connues

- Les replays sont a regarder dans OpenReplay.
- Dead clicks actives dans le projet le 2026-07-02 (`capture_dead_clicks`) ; les donnees demarrent a cette date.
- Exception autocapture activee le 2026-07-02 (`autocapture_exceptions_opt_in`) ; a surveiller cote privacy (messages, stack traces) avant d'elargir.
- Les events P1 demarrent a partir du deploy qui contient cette instrumentation ; les periodes precedentes resteront vides pour ces noms d'evenements. Premiere ingestion observee : 2026-06-26. `quote_accepted` / `quote_declined` et le `checkout_payment_started` du compte client demarrent au deploy suivant le 2026-07-02.
- Storefront track dans PostHog depuis le deploy du 2026-07-02 (fix `/ingest` dans `proxy.ts` + config exemptee de consentement : `persistence: memory`, events anonymes, pas de replay/autocapture/heatmaps — voir [setup-review-2026-07.md](setup-review-2026-07.md)). Avant cette date : zero event client storefront. Les pageviews storefront portent `surface: storefront` et `store_slug`. Le tracking MySQL via `/api/track` (`pageViews`, `storefrontEvents`) continue en parallele.
- Les visiteurs storefront sont anonymes et changent de distinct id a chaque rechargement complet : funnels intra-session uniquement, pas de stitch automatique avec les events serveur en `customer.id`.
- Toutes les boutiques sont en `reservationMode = request` : le paiement se joue apres acceptation du devis, pas au checkout. Interpreter les funnels checkout en consequence.
