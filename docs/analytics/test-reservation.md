# Analytics — Réservation test

Instrumentation PostHog de la réservation test : le loueur réserve sur sa propre boutique comme
un client, gère la réservation dans le dashboard, puis supprime les données de test
(`packages/db/src/test-reservations.ts`, `packages/api/src/services/test-reservations.ts`).

Tous les événements portent les propriétés de base `analytics_area: core_product` et
`analytics_version: 1` (voir `apps/web/lib/product-analytics/analytics-events.ts`), plus
`feature: test_reservation`, `surface` et `store_id`. Ils ne portent que des codes : jamais un
nom, un e-mail, un montant ni un numéro de réservation.

Une réservation test n'émet aucun des événements ordinaires d'une réservation
(`reservation_action_succeeded`, `checkout_reservation_created`…) : seuls les quatre événements
ci-dessous la comptent, pour que les funnels réels ne mélangent pas les essais.

## Événements

| Événement                    | Quand                                                                                  | distinct_id                                                                    | Propriétés propres                        |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `test_reservation_started`   | Le loueur clique « Faire une réservation test » et la boutique s'ouvre en mode test    | l'utilisateur du dashboard                                                     | —                                         |
| `test_reservation_completed` | La réservation test est passée sur la boutique (checkout terminé)                      | l'utilisateur qui a lancé le test                                              | `surface: storefront`, `reservation_mode` |
| `test_reservation_managed`   | Le loueur change le statut de la réservation test, ou crée / termine un état des lieux | l'utilisateur du dashboard                                                     | `action`                                  |
| `test_reservation_deleted`   | Les données de test sont supprimées                                                    | l'utilisateur, ou le propriétaire de la boutique pour le nettoyage automatique | `trigger`                                 |

`action` de `test_reservation_managed` :

- `status_confirmed`, `status_ongoing`, `status_completed`, `status_cancelled`, `status_rejected` :
  le nouveau statut (`packages/api/src/services/reservation-status.ts`, après le commit) ;
- `inspection_departure_created`, `inspection_departure_completed`,
  `inspection_return_created`, `inspection_return_completed` : un état des lieux
  (`apps/web/app/(dashboard)/dashboard/reservations/[id]/inspection/actions.ts`).

`trigger` de `test_reservation_deleted` :

- `manual` : « Supprimer les données de test » dans le dashboard (`testReservations.delete`) ;
- `expired` : le nettoyage d'une réservation test de plus de 7 jours, par le cron quotidien
  (4 h 15 UTC) ou au lancement d'un nouveau test (`testReservations.start`).

## Envoi

`started`, `managed` et `deleted` passent par l'outbox de l'API (`api_effects`, type
`testReservation.analytics`) : la ligne est écrite dans la transaction de l'action quand il y en
a une (la suppression), sinon juste après, puis envoyée par
`apps/web/lib/test-reservations/lifecycle-effects.ts`. Un envoi refusé par PostHog est retenté
par le cron, avec le même identifiant d'événement : PostHog n'en garde qu'un.
`completed` est envoyé directement par la boutique
(`apps/web/lib/reservations/post-creation-effects.ts`).

## Instance auto-hébergée

Sans `NEXT_PUBLIC_POSTHOG_KEY`, rien ne part : la ligne d'outbox est marquée « rien à envoyer »
(`skipped`) et `completed` passe par le client PostHog vide. Sans cron, le nettoyage des tests
de plus de 7 jours se fait au lancement du test suivant.

## Analyses visées

- Part des boutiques qui lancent un test après leur premier produit (`product_created` →
  `test_reservation_started`).
- Part des tests lancés qui vont jusqu'à la réservation (`started` → `completed`), puis jusqu'à
  la clôture (`managed` avec `action: status_completed`).
- Suppression manuelle ou expiration (`trigger`), et premier vrai client ensuite
  (`checkout_reservation_created`).
