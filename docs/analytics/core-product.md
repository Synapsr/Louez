# Core Product Analytics

## Dashboard

- Outil : PostHog
- Projet : `Louez.io` / `Default project` / id `118395`
- Periode par defaut : `-30d` pour le suivi courant, `-90d` pour relire un flux peu frequente

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

Les proprietes ne doivent pas contenir de nom client, email, telephone, adresse, nom produit, note libre ou payload Stripe complet. Les IDs internes, montants agreges, counts, flags et statuts sont autorises.

## Signaux de friction

- `Dead click` : clic sur un element qui semble actionnable mais ne produit pas de retour visible utile, comme navigation, mutation DOM, ouverture de menu/modal ou requete pertinente. C'est utile pour trouver des boutons morts, affordances trompeuses ou handlers casses. Le signal peut etre bruite et doit etre recoupe avec OpenReplay.
- `Exception` : erreur runtime capturee par le navigateur ou le serveur, par exemple une exception JavaScript non geree, une erreur React, ou une erreur applicative remontee a l'outil. C'est un signal plus dur qu'un dead click, mais il peut exposer stack traces ou messages sensibles ; l'activation doit etre revue cote privacy avant d'elargir la capture.

## Funnels initiaux

- Onboarding : `onboarding_store_info_saved` -> `onboarding_completed` -> `product_created`
- Catalogue marchand : `product_created` -> `dashboard_reservation_created`
- Checkout storefront : `checkout_reservation_created` -> `checkout_payment_started` -> `checkout_payment_completed`
- Paiement sans friction : `checkout_payment_started` -> `checkout_payment_completed`, breakdown par `payment_mode`, `reservation_fee_cents`, `has_tulip_insurance`, `has_delivery`

## Limites connues

- Les replays sont a regarder dans OpenReplay.
- Les dead clicks PostHog ne sont pas actives dans le projet au 2026-06-26.
- Les exceptions PostHog ne sont pas encore instrumentees comme source d'erreur produit au 2026-06-26.
- Les events P1 demarrent a partir du deploy qui contient cette instrumentation ; les periodes precedentes resteront vides pour ces noms d'evenements.
