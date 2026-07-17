# Onboarding Analytics

## Dashboard

- Outil : PostHog
- Projet : `Louez.io` / `Default project` / id `118395`
- Periode par defaut : `-30d` pour le funnel courant, `-90d` pour les tendances (flow recent, volume faible)
- Dashboard : [Louez Onboarding](https://eu.posthog.com/project/118395/dashboard/824728) (cree le 2026-07-16). `scripts/posthog/setup-onboarding-dashboard.mjs` permet de le recreer a l'identique si besoin (necessite `POSTHOG_PERSONAL_API_KEY`).

## Questions produit

- Ou les marchands abandonnent-ils le flow d'onboarding (profil, store, branding, paiement, source) ?
- Le redesign 2026-07 ameliore-t-il la completion par rapport a l'ancien flow ?
- Quel mode de reservation est choisi a la fin, et combien demarrent le KYC Stripe immediatement ?
- Quels canaux d'acquisition sont declares, et quelle part de marchands passe la question ?
- Quelles erreurs bloquent les marchands, et sur quelle etape ?
- Les marchands personnalisent-ils leur boutique (logo, couleur, theme) ou gardent-ils les defauts ?

## Evenements

Tous les evenements portent `feature: onboarding`, `surface: dashboard`, `analytics_area: core_product`. Distinct id = `user.id` sur tout le flow (client identifie via `PostHogIdentify`, serveur via `session.user.id`) : les funnels restent dans un seul stream d'identite.

| Evenement                           | Cote    | Moment d'emission                                                   | Proprietes principales                                                                                                       |
| ----------------------------------- | ------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `onboarding_step_viewed`            | client  | Arrivee sur une etape (changement de pathname dans la shell)        | `step` (profile/store/branding/payment/source), `step_index`, `steps_total`, `includes_profile_step`, `includes_source_step` |
| `onboarding_profile_completed`      | serveur | Sauvegarde de l'etape profil                                        | `business_type`, `product_category`, `fleet_size`, `avatar_action`, `$set` des trois segments                                |
| `onboarding_store_info_saved`       | serveur | Sauvegarde de l'etape infos store                                   | `store_id`, `country`, `currency`, `referral_outcome`, flags de completude                                                   |
| `onboarding_branding_saved`         | client  | Mutation branding reussie, avant navigation vers l'etape paiement   | `has_logo`, `theme`, `primary_color`, `is_default_primary_color`                                                             |
| `onboarding_stripe_connect_started` | client  | Clic sur "configurer maintenant" (panneau paiement), avant redirect | `is_resume` (KYC repris vs demarre)                                                                                          |
| `onboarding_completed`              | serveur | `onboardingCompleted` passe a `true`                                | `store_id`, `reservation_mode`                                                                                               |
| `acquisition_channel_reported`      | serveur | Reponse a la question canal d'acquisition (hors skip)               | `acquisition_channel`, `acquisition_channel_other`, `$set.acquisition_channel`                                               |
| `onboarding_source_skipped`         | serveur | Skip de la question canal d'acquisition                             | —                                                                                                                            |
| `onboarding_error_shown`            | client  | Toast d'erreur affiche sur une etape (`useOnboardingErrorToast`)    | `step`, `error_key` (cle `errors.*` connue ou `unknown`, jamais de message libre)                                            |

Pas de PII dans les proprietes : pas de nom, email, adresse, ni message d'erreur libre (seules les cles `errors.*` sont capturees).

## Funnels et insights

Tous sur le dashboard [Louez Onboarding](https://eu.posthog.com/project/118395/dashboard/824728) :

- [Funnel store](https://eu.posthog.com/project/118395/insights/wmsCD626) : `onboarding_step_viewed (step=store)` -> `onboarding_store_info_saved` -> `onboarding_branding_saved` -> `onboarding_step_viewed (step=payment)` -> `onboarding_completed` (fenetre 14j)
- [Funnel activation](https://eu.posthog.com/project/118395/insights/jazeZo5U) : `onboarding_step_viewed` -> `onboarding_completed` -> `product_created` (fenetre 30j, -90d)
- [Funnel profil](https://eu.posthog.com/project/118395/insights/ymm6ogUN) : `onboarding_step_viewed (step=profile)` -> `onboarding_profile_completed`
- [Trend completion](https://eu.posthog.com/project/118395/insights/VMFnS8EW) : onboardings completes par semaine (uniques)
- [Mode de reservation](https://eu.posthog.com/project/118395/insights/D4GTkaF6) : `onboarding_completed` par `reservation_mode`
- [Canaux d'acquisition](https://eu.posthog.com/project/118395/insights/fgiGXDMz) : `acquisition_channel_reported` par `acquisition_channel` + volume `onboarding_source_skipped`
- [Erreurs par etape](https://eu.posthog.com/project/118395/insights/kG9GFJgh) : `onboarding_error_shown` par `step`
- [Adoption Stripe Connect](https://eu.posthog.com/project/118395/insights/SRqTfDqb) : `onboarding_stripe_connect_started` vs `onboarding_completed (reservation_mode=payment)`
- [Categories de produits](https://eu.posthog.com/project/118395/insights/cF7sK5z0) : `onboarding_profile_completed` par `product_category`
- [Taille de flotte](https://eu.posthog.com/project/118395/insights/hXlMQoI9) : `onboarding_profile_completed` par `fleet_size`

## Segments utiles

- `includes_profile_step` / `includes_source_step` : compare le flow court (store existant) au flow long (premier store)
- `country`, `currency` sur `onboarding_store_info_saved`
- `business_type`, `product_category`, `fleet_size` (person properties, via `$set`) : les trois segments ICP declares a l'etape profil. `business_type = individual` mesure la demande particuliers (P2P) avant de construire pour eux.
- `acquisition_channel` (person property) : croise le canal avec l'activation en aval
- `referral_outcome` : les marchands parraines convertissent-ils mieux ?

## Limites connues

- Les etapes profil et source sont user-level et conditionnelles : elles n'apparaissent que la premiere fois. Les funnels globaux doivent demarrer sur `step=store`, pas `step=profile`.
- Les evenements demarrent au deploy du redesign onboarding (2026-07) ; avant cette date seuls `onboarding_store_info_saved` / `onboarding_completed` existent (voir [core-product.md](core-product.md)).
- `onboarding_branding_saved` et `onboarding_stripe_connect_started` sont captures cote client : un adblocker non intercepte par `/ingest` ou une fermeture immediate de l'onglet peut en perdre une petite fraction.
- `onboarding_step_viewed (step=payment)` peut manquer pour un user qui revient d'un KYC Stripe interrompu directement sur `/onboarding/source`.
- La capture est desactivee en developpement (`opt_out_capturing`).

## Prochaines analyses

- Temps median par etape (funnel avec time-to-convert) une fois le volume suffisant.
- Correler `acquisition_channel` avec l'activation (`product_created`, premiere reservation).
- Activation et retention par `product_category` et `fleet_size` : quel segment convertit le mieux ? Decide l'elargissement au-dela du vertical velo.
- Volume de `business_type = individual` : si significatif, evaluer l'offre particuliers (P2P) — attention aux implications KYC Stripe personnes physiques et DAC7 avant de construire.
- Completion du KYC Stripe apres `onboarding_stripe_connect_started` (necessite un event serveur sur `charges_enabled`, non instrumente aujourd'hui).
- A/B sur l'ordre des etapes ou le wording du mode paiement si le drop sur l'etape payment est confirme.
