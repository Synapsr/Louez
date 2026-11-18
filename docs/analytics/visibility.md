# Analytics — « Se faire connaître »

Instrumentation du guide « Se faire connaître » (`/dashboard/visibility`), décrit dans
[docs/product/visibilite-boutiques.md](../product/visibilite-boutiques.md). Deux sources, qui ne
mesurent pas la même chose :

- **la base**, source de vérité, insensible aux bloqueurs de pub : `store_visibility_steps`
  (une ligne par étape décidée) et `page_views.source` (le canal du lien par lequel une visite
  est arrivée, plus `source` dans les métadonnées des `storefront_events` de la visite) ;
- **PostHog**, pour les funnels : trois événements envoyés par le navigateur du dashboard.

## Événements PostHog

Propriétés de base : `analytics_area: core_product`, `analytics_version: 1`,
`feature: visibility`, `surface: dashboard`, `store_id` et le groupe `store`
(`apps/web/components/dashboard/visibility/use-visibility-analytics.ts`). Ils ne portent que des
codes : jamais un nom, un message ni un lien.

| Événement                   | Quand                                                                                             | Propriétés propres                         |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `visibility_viewed`         | La page est ouverte, ou la carte d'accueil est montrée (une fois par affichage)                   | `placement`, `done_count`, `skipped_count` |
| `visibility_share_used`     | Le loueur ouvre un canal, copie un lien ou un message, enregistre l'affiche, copie le lien Google | `placement`, `channel`, `target`           |
| `visibility_step_completed` | Il change le statut d'une étape                                                                   | `step`, `status`                           |

- `placement` : `page` (la page du guide), `home_card` (la carte de l'accueil),
  `storefront_card` (la fenêtre « Partager » de la carte « Votre boutique »).
- `channel` : la valeur `via` du lien (`whatsapp`, `sms`, `email`, `facebook`, `copy`, `qr`,
  `google`).
- `target` : `store` (l'accueil de la boutique) ou `product` (la page d'un produit).
- `step` : `share_contacts`, `qr_poster`, `google_business`.
- `status` : `done`, `skipped` (« Pas pour moi »), `todo` (étape rouverte).

Sans `NEXT_PUBLIC_POSTHOG_KEY`, rien ne part ; la base suffit.

## Source des visites (`?via=`)

Les outils du guide marquent leurs liens avec `?via=<canal>` (`VISIT_SOURCES`,
`packages/api/src/contracts/visibility.ts`). La boutique lit le paramètre à la première page de
l'onglet et le garde pour la visite (`sessionStorage`, `apps/web/contexts/analytics-context.tsx`) ;
chaque page vue l'envoie à `/api/track`, qui ne garde qu'une valeur de la liste. Le paramètre
`ref` reste celui du parrainage (`proxy.ts`). Les URL canoniques ne portent pas `via`.

La page du guide affiche les visites (sessions distinctes) par source sur 28 jours
(`visibility.get`, `packages/api/src/services/visibility.ts`).

## Analyses visées

Définitions et limites : section « Événements à mesurer » de la spec.

- Lecture principale, en SQL : parmi les boutiques éligibles (en ligne avec un produit actif),
  part qui reçoit au moins une visite `via` à J+7 et J+28, et part dont la première réservation
  réelle (boutique en ligne, hors test) a une session `via`
  (`storefront_events.metadata.source` sur `checkout_completed`).
- Funnel PostHog `visibility_viewed` (placement `home_card`) → `visibility_share_used` →
  `visibility_step_completed` (status `done`).
- `visibility_share_used` ventilé par `channel` : quels canaux les loueurs utilisent.
