# Analytics — Création de réservation

Instrumentation PostHog des deux flows de création de réservation (juillet 2026).
Dashboard PostHog : [Louez Reservations](https://eu.posthog.com/project/118395/dashboard/846337).

Tous les événements portent les propriétés de base `analytics_area: core_product` et
`analytics_version: 1` (voir `apps/web/lib/product-analytics/analytics-events.ts`), plus
`feature` / `surface` propres à chaque flow.

## Flow dashboard — création manuelle (page unique)

Depuis juillet 2026, la création manuelle est une **page unique sans stepper** (sections
client / période / produits / livraison / notes + panneau récapitulatif sticky), alignée sur
le flow de création de produit. La validation se joue au submit : les événements de
validation portent une propriété `step` qui désigne la **section** en échec.

Émis côté client dans `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`
(`feature: reservation_creation`, `surface: dashboard`). Le distinct_id est l'utilisateur
identifié (`user.id`), le même que l'événement serveur `dashboard_reservation_created`
(`store.userId`) : le funnel client → serveur se raccorde.

| Événement                                              | Quand                                                             | Propriétés clés                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `dashboard_reservation_creation_started`               | Montage de la page                                                | `source` (header, quick_action, calendrier…)                            |
| `dashboard_reservation_step_validation_failed`         | Section invalide au submit                                        | `step` (customer/period/products/delivery), `failed_fields[]`, `source` |
| `dashboard_reservation_capacity_blocked`               | Le serveur refuse pour capacité insuffisante (dialog overbooking) | `shortfall_count`, `shortfall_product_ids[]`, `source`                  |
| `dashboard_reservation_overbooking_confirmed`          | L'admin force la création malgré l'alerte                         | `shortfall_count`, `source`                                             |
| `dashboard_reservation_creation_failed`                | Erreur serveur à la soumission                                    | `error_code`, `source`                                                  |
| `dashboard_reservation_created` (serveur, préexistant) | Réservation créée                                                 | voir `reservations/actions.ts`                                          |

> `dashboard_reservation_step_viewed` a existé brièvement (wizard à étapes, jamais déployé)
> et a été retiré avec le passage en page unique. L'insight PostHog « Funnel creation
> reservation (dashboard) » doit être redéfini en `creation_started` → `created`.

## Flow storefront — checkout client

Émis côté client dans `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`
(`feature: checkout`, `surface: storefront`). Attention : l'événement serveur
`checkout_reservation_created` est attribué au `customerId` (id BDD), pas au distinct_id
anonyme du navigateur — d'où l'événement client `checkout_completed` qui sert de dernière
étape aux funnels.

| Événement                                                                     | Quand                                                                                               | Propriétés clés                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `checkout_step_viewed`                                                        | Changement d'étape visible                                                                          | `step` (contact/delivery/confirm), `step_index`, `steps_total`, `direction`, `store_id`                       |
| `checkout_step_validation_failed`                                             | Blocage par la validation client, y compris un délai de prévenance devenu invalide avant l'envoi    | `step`, `failed_fields[]`, `error_code`, `validation_type`, `store_id`                                        |
| `checkout_submit_failed`                                                      | Échec pendant la soumission ; `failure_source` distingue une précondition client d'un refus serveur | `error_code`, `failure_source`, `store_id`                                                                    |
| `checkout_validation_recovered`                                               | Correction réussie après une validation bloquante du checkout                                       | `error_code`, `original_failure_source`, `recovery_action`, `store_id`                                        |
| `checkout_completed`                                                          | Réservation soumise avec succès (avant redirect Stripe éventuel)                                    | `reservation_id`, `reservation_mode`, `item_count`, `subtotal_amount_cents`, `total_amount_cents`, `store_id` |
| `checkout_reservation_created` / `checkout_payment_*` (serveur, préexistants) | Création + paiement                                                                                 | voir `checkout/actions.ts`                                                                                    |

## Notes

- Le tracking préexistant n'est pas touché : OpenReplay (wizard dashboard) et `/api/track`
  (storefront) continuent d'émettre en parallèle.
- Les insights du dashboard PostHog sont vides tant que cette instrumentation n'est pas
  déployée ; seuls `dashboard_reservation_created` / `checkout_reservation_created` ont
  déjà des données.
