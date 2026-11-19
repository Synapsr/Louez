# Analytics — Accueil du dashboard

La carte « prochaine étape » de l'accueil, une seule à la fois
([docs/product/accueil-prochaine-etape.md](../product/accueil-prochaine-etape.md)).

## Événement

Propriétés de base : `analytics_area: core_product`, `analytics_version: 1`,
`feature: home_next_step`, `surface: dashboard`, `store_id` et le groupe `store`
(`apps/web/components/dashboard/home/home-next-step-viewed.tsx`). Des codes seulement.

| Événement               | Quand                                                                 | Propriétés propres |
| ----------------------- | --------------------------------------------------------------------- | ------------------ |
| `home_next_step_viewed` | L'accueil montre sa carte de prochaine étape (une fois par affichage) | `step`             |

`step` : `reeentStripe`, `firstProduct`, `testReservation`, `planOffer`, `visibility`,
`agentAssistant`, `cohort`. Rien ne part quand l'accueil n'a aucune carte à montrer.

Les événements propres à chaque carte ne changent pas, mais ne partent plus que quand la carte
est la prochaine étape : `visibility_viewed` (`placement: home_card`), `plan_offer_shown`, et
les événements de la réservation test. Un `visibility_viewed` d'accueil plus rare qu'avant le
18 novembre 2026 vient de là, pas d'une baisse d'intérêt. Depuis le 19 novembre 2026, une
boutique établie (une vraie réservation acceptée ou un paiement reçu) ne voit plus les cartes
`firstProduct`, `visibility` et `agentAssistant` : la baisse de ces valeurs de `step` vient de
là.

Sans `NEXT_PUBLIC_POSTHOG_KEY`, rien ne part.

## Analyses visées

- Répartition des boutiques par `step` : où en sont-elles.
- Funnel `home_next_step_viewed` (`step: testReservation`) → `test_reservation_started` ;
  (`step: visibility`) → `visibility_share_used`.

## Related

- [visibility.md](visibility.md)
- [test-reservation.md](test-reservation.md)
