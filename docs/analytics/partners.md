# Analytics — Liens partenaires

Instrumentation de « Partenaires » (`/dashboard/visibility/partners`), décrit dans
[docs/product/liens-partenaires.md](../product/liens-partenaires.md). Deux sources :

- **la base**, source de vérité : `store_partners`, `partner_bookings` (une ligne par
  réservation attribuée, `origin` = `link` | `manual`), `partner_payouts` (ce que la boutique a
  noté payé) et `page_views.partner_id` (les pages vues d'un visiteur venu par le lien d'un
  partenaire, pendant la durée du lien) ;
- **PostHog**, pour les funnels : des événements envoyés par le navigateur du dashboard.

## Événements PostHog

Propriétés de base : `analytics_area: core_product`, `analytics_version: 1`,
`feature: partners`, `surface: dashboard`, `store_id` et le groupe `store`
(`apps/web/components/dashboard/partners/use-partners-analytics.ts`). Ils ne portent que des
codes et des compteurs : jamais un nom de partenaire, un contact, un lien ni un montant.

| Événement                     | Quand                                                                     | Propriétés propres           |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------- |
| `partners_viewed`             | La liste ou la fiche d'un partenaire est ouverte (une fois par affichage) | `placement`, `partner_count` |
| `partner_created`             | Un partenaire est ajouté                                                  | `commission_type`            |
| `partner_link_shared`         | Le loueur copie le lien, enregistre l'affiche, l'envoie, copie le relevé  | `channel`                    |
| `partner_month_paid`          | Un mois est marqué payé                                                   | `booking_count`              |
| `partner_statement_exported`  | Le relevé d'un mois est exporté                                           | `format` (`csv`)             |
| `partner_reservation_changed` | Une réservation est attribuée, retirée, ajustée, ou revient au calcul     | `action`                     |

- `placement` : `list`, `partner`.
- `commission_type` : `percent`, `fixed`.
- `channel` : `copy`, `qr`, `email`, `whatsapp`, `space_link` (le lien de l'espace du partenaire).
- `action` : `attributed`, `removed`, `adjusted`, `adjustment_removed`.

Sans `NEXT_PUBLIC_POSTHOG_KEY`, rien ne part ; la base suffit.

## Ce que la base mesure

- Boutiques avec un partenaire, et parmi elles celles qui ont une réservation `origin = link`.
- **Succès** (spec) : un premier mois marqué payé (`partner_payouts`), puis une réservation par
  lien le mois suivant pour le même partenaire.
- Les réservations par origine : `partner_bookings.origin` (`link`, `code`, `manual`).
- Les e-mails aux partenaires passent par l'outbox (`api_effects`, types `partner.*`) : envoyés,
  annulés (partenaire sans adresse ou qui les a coupés) ou en échec s'y lisent 30 jours.
- L'espace partenaire (`/partner/<secret>`) ne charge aucun outil d'analyse.

## Related

- [visibility.md](visibility.md) — « Se faire connaître ».
- [docs/product/liens-partenaires.md](../product/liens-partenaires.md) — la spec.
