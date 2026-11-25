# Analytics — Catalogue des événements

Tous les événements que l'app envoie à PostHog, côté serveur et côté navigateur : leur nom,
quand ils partent, d'où (le fichier), le jour où leur envoi est arrivé sur `main` (historique
git) et leurs limites connues. Les propriétés et les analyses de chaque domaine sont dans sa
page, liée dans chaque section ; cette page ne les répète pas.

La date « Sur `main` » est celle du commit ou de la fusion de la PR qui a amené l'envoi sur
`main`. La mise en production peut venir un peu après : un événement ne compte rien avant sa
date, et une boutique déjà passée par l'étape avant cette date n'a pas l'événement.

## Règles communes

- **Sans `NEXT_PUBLIC_POSTHOG_KEY`** (auto-hébergement), rien ne part et rien ne plante. En
  développement local, le navigateur n'envoie rien (`opt_out_capturing`).
- **Côté serveur**, l'événement est compté sur le loueur (`users.id`, pour une boutique celui
  de son propriétaire), sauf ceux du client final d'une boutique, comptés sur `customers.id`.
  Un événement qui porte un `store_id` porte aussi le groupe `store` ([lifecycle.md](lifecycle.md)).
- **Côté navigateur**, le dashboard identifie le loueur connecté ; la boutique en ligne reste
  anonyme (persistance en mémoire, pas d'autocapture ni d'enregistrement de session). Rien ne
  part d'un navigateur qui demande Do Not Track (`respect_dnt`).
- **Boutiques de démo** ([demo-par-metier.md](../demo-par-metier.md)) : depuis le 2026-11-25,
  aucun événement métier ne part pour elles, ni serveur (`isAboutDemoStore`) ni navigateur
  (PostHog n'y est pas chargé). Seuls `demo_*` les comptent.
- Les envois marqués « outbox » passent par `api_effects` : un identifiant et une date fixés à
  l'écriture, donc un seul événement PostHog même après un nouvel essai.

## Avant l'app : le site louez.io

Ces événements ne sont pas envoyés par l'app. Ils sont décrits dans le dépôt du site,
`Synapsr/Louez-Website`, fichier `docs/analytics.md`.

- **`signup_started`** est le clic du site vers l'app, pas un compte créé. Le compte créé, c'est
  `account_created` (ci-dessous). Beaucoup de ces clics viennent de personnes qui ont déjà un
  compte : voir `hasAccount`, plus bas.
- **La conversion Google Ads « Inscription »** est ce même clic, limité aux visiteurs venus d'une
  annonce. La conversion « Compte créé », elle, est envoyée par le serveur de l'app à chaque
  compte venu d'une annonce ([lifecycle.md](lifecycle.md)).
- **`website_session_status`** (propriété du site, `anonymous` ou `unknown` sur
  `signup_started`) et **`app_access_clicked`** (événement du site, le clic vers l'app d'une
  session reconnue) existent depuis le 2026-09-17. Le site les déduit de
  `/api/marketing/session`, la section suivante.

## Le statut de session lu par le site : `/api/marketing/session`

Le site appelle `GET /api/marketing/session` depuis le navigateur du visiteur, avec ses cookies.
Réponse :

```json
{ "authenticated": true, "hasAccount": true }
```

- **`authenticated`** : une session de connexion est valide sur ce navigateur. Celle d'un
  visiteur de démo compte aussi : `/api/demo/start` le connecte au compte jetable de sa boutique
  de démo.
- **`hasAccount`** : ce navigateur appartient déjà à quelqu'un qui a un compte Louez. Vrai pour
  une session connectée qui n'est pas celle d'un compte de démo (`visiteur-…@demo.example`).
  Déconnecté, vrai quand le cookie `louez_active_store` nomme une vraie boutique, qui existe et
  n'est pas une boutique de démo. Ce cookie est posé par la création d'une boutique et par le
  changement de boutique active, gardé un an, et la déconnexion ne l'efface pas.
  `/api/demo/start` le fait pointer sur la boutique de démo : un visiteur de démo lit `false`.

`hasAccount` est un indice **par appareil**. `false` veut dire « aucun compte connu sur cet
appareil », pas « une nouvelle personne » : un autre navigateur, une fenêtre privée, des cookies
effacés, ou un compte déconnecté qui n'a jamais créé ni changé de boutique sur ce navigateur
donnent `false`. `true` ne dit pas qui : sur un ordinateur partagé, ce peut être une autre
personne.

Ce que la réponse ne contient jamais : un identifiant, une adresse e-mail, une boutique. Elle
lit des cookies que l'app pose déjà et n'en pose aucun.

Règles d'accès, les mêmes pour les deux valeurs :

- seules les origines du site répondent (`louez.io` et `www.louez.io` en production,
  `louez.app` et `www.louez.app` en préproduction, plus `MARKETING_WEBSITE_ORIGINS`) ; une autre
  origine reçoit 403, sans en-tête CORS ;
- `Access-Control-Allow-Credentials: true`, `Cache-Control: private, no-store`, `Vary: Origin` ;
  la requête de contrôle (`OPTIONS`) répond 204 sans lire la session ;
- si la session ou la base ne répondent pas : 503 et `{ "error": "session_unavailable" }`, que le
  site lit comme `unknown`.

Code : `apps/web/lib/marketing-session.ts` et `apps/web/app/api/marketing/session/route.ts`.
Tests : `marketing-session.test.ts` et `marketing-session.db.test.ts` à côté, et le contrôle
HTTP d'un déploiement : `apps/web/scripts/check-marketing-session.mjs`.

## Événements de l'app

### Compte et onboarding

Détails : [lifecycle.md](lifecycle.md) (attribution) et [store-setup.md](store-setup.md).

| Événement                           | Côté             | Quand                                                           | Où                                                                     | Sur `main` | Limites connues                                                                                                                                                                                     |
| ----------------------------------- | ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_created`                   | serveur          | Un compte est créé (code e-mail vérifié ou retour de Google)    | `apps/web/lib/auth.ts`                                                 | 2026-08-12 | Un compte créé sans requête (un script) n'a aucune attribution                                                                                                                                      |
| `onboarding_step_viewed`            | navigateur       | Une étape du wizard d'onboarding s'affiche                      | `apps/web/app/(dashboard)/onboarding/_components/onboarding-shell.tsx` | 2026-07-17 |                                                                                                                                                                                                     |
| `onboarding_profile_completed`      | serveur          | L'étape « profil » est enregistrée                              | `apps/web/app/(dashboard)/onboarding/profile-actions.ts`               | 2026-07-17 |                                                                                                                                                                                                     |
| `acquisition_channel_reported`      | serveur          | Le loueur répond à « comment nous avez-vous connus ? »          | `apps/web/app/(dashboard)/onboarding/profile-actions.ts`               | 2026-07-17 | Une seule réponse par compte, jamais remplacée. `acquisition_channel_other` est le texte libre tapé par le loueur                                                                                   |
| `onboarding_source_skipped`         | serveur          | Il passe cette question                                         | `apps/web/app/(dashboard)/onboarding/profile-actions.ts`               | 2026-07-17 |                                                                                                                                                                                                     |
| `onboarding_store_info_saved`       | serveur (outbox) | Création de la boutique, ou étape « boutique » du wizard        | `apps/web/lib/stores/store-creation-effects.ts`                        | 2026-06-26 |                                                                                                                                                                                                     |
| `onboarding_branding_saved`         | navigateur       | L'étape « apparence » est enregistrée                           | `apps/web/app/(dashboard)/onboarding/branding/use-branding-step.ts`    | 2026-07-17 |                                                                                                                                                                                                     |
| `onboarding_stripe_connect_started` | navigateur       | Le loueur part vers Stripe depuis l'onboarding                  | `apps/web/app/(dashboard)/onboarding/_lib/use-stripe-connect-start.ts` | 2026-07-17 | Ne couvre que l'onboarding (étape paiement du wizard, page Stripe de reeent) : une connexion lancée depuis les réglages ou par un agent n'est pas comptée. Pour toutes : `stripe_connect_completed` |
| `onboarding_error_shown`            | navigateur       | Une erreur s'affiche dans l'onboarding                          | `apps/web/app/(dashboard)/onboarding/_lib/onboarding-error-toast.ts`   | 2026-07-17 |                                                                                                                                                                                                     |
| `onboarding_completed`              | serveur (outbox) | La boutique est mise en ligne, par le wizard ou un agent        | `apps/web/lib/stores/store-launch-effects.ts`                          | 2026-06-26 | Même instant que `store_published`                                                                                                                                                                  |
| `agent_store_setup_action`          | serveur (outbox) | Chaque écriture d'un agent sur une boutique pas encore en ligne | `apps/web/lib/stores/store-setup-effects.ts`                           | 2026-11-09 | Au mieux : perdu (et journalisé) si sa propre ligne d'outbox ne s'écrit pas                                                                                                                         |

### Cycle de vie d'une boutique

Détails : [lifecycle.md](lifecycle.md). Tous serveur, par l'outbox, envoyés par
`apps/web/lib/stores/store-lifecycle-effects.ts`.

| Événement                  | Quand                                                  | Où (le fait)                                        | Sur `main` | Limites connues                                                                                                                |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `store_published`          | La boutique passe en ligne                             | `packages/api/src/services/launch.ts`               | 2026-11-17 | Existe depuis le 2026-11-17 : une boutique mise en ligne avant ne l'a pas (`onboarding_completed` la couvre)                   |
| `stripe_connect_completed` | Le compte Stripe Connect de la boutique peut encaisser | `packages/api/src/services/stripe-connect.ts`       | 2026-11-17 | Une boutique déjà connectée, ou qui avait déjà encaissé par Stripe, ne le compte pas                                           |
| `subscription_started`     | Un plan Pro ou Ultra est acheté                        | `apps/web/lib/stripe/subscription-analytics.ts`     | 2026-11-17 |                                                                                                                                |
| `subscription_changed`     | L'abonnement change de plan, de période, d'annulation… | `apps/web/lib/stripe/subscription-analytics.ts`     | 2026-11-17 | Pas sur un renouvellement ni une relance de paiement                                                                           |
| `subscription_canceled`    | L'abonnement est terminé                               | `apps/web/lib/stripe/subscription-analytics.ts`     | 2026-11-17 |                                                                                                                                |
| `payg_fee_charged`         | La commission d'un paiement en ligne est prélevée      | `apps/web/app/api/webhooks/stripe/connect/route.ts` | 2026-11-17 | Les commissions des réservations payées hors ligne ne sont pas comptées : le service de facturation les facture en fin de mois |

### Catalogue

| Événement         | Côté    | Quand               | Où                                 | Sur `main` | Limites connues                                                                                                                                                                                                                                                     |
| ----------------- | ------- | ------------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_created` | serveur | Un produit est créé | `apps/web/lib/api/after-commit.ts` | 2026-06-26 | Pas envoyé pour les produits créés par l'assistant de l'app et par le MCP avant le 2026-11-09 (PR #95). `created_from` vaut `dashboard` aussi pour l'assistant de l'app (il passe par les mêmes procédures), `openapi` ou `mcp` pour un client de l'API ou un agent |

### Réservations du dashboard

Détails : [reservations.md](reservations.md).

| Événement                                          | Côté                 | Quand                                                                | Où                                                                                                                   | Sur `main` | Limites connues                                                                                                                                                      |
| -------------------------------------------------- | -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard_reservation_created`                    | serveur              | Une réservation est créée depuis le dashboard, l'API ou un agent     | `apps/web/lib/api/after-commit.ts`, `apps/web/app/(dashboard)/dashboard/reservations/actions.ts`                     | 2026-06-26 |                                                                                                                                                                      |
| `dashboard_reservation_creation_started`           | navigateur           | La page de création manuelle s'ouvre                                 | `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`                                       | 2026-08-04 | Ne couvre que la page du dashboard : l'API et les agents ne l'envoient pas                                                                                           |
| `dashboard_reservation_step_validation_failed`     | navigateur           | Une section est invalide à l'envoi                                   | `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`                                       | 2026-08-04 |                                                                                                                                                                      |
| `dashboard_reservation_capacity_blocked`           | navigateur           | Le serveur refuse faute de stock (création ou modification)          | `…/reservations/new/new-reservation-form.tsx`, `…/reservations/[id]/edit/edit-reservation-form.tsx`                  | 2026-08-04 |                                                                                                                                                                      |
| `dashboard_reservation_overbooking_confirmed`      | navigateur           | L'admin force malgré le stock (création, modification, confirmation) | les deux formulaires, `…/reservations/reservations-actions.tsx`, `…/reservations/[id]/smart-reservation-actions.tsx` | 2026-08-04 | Sur la confirmation d'une demande, depuis le 2026-11-17 seulement                                                                                                    |
| `dashboard_reservation_turnover_buffer_overridden` | navigateur           | L'admin confirme malgré la marge de rotation                         | `…/reservations/reservations-actions.tsx`, `…/reservations/[id]/smart-reservation-actions.tsx`                       | 2026-11-17 |                                                                                                                                                                      |
| `dashboard_reservation_creation_failed`            | navigateur           | Erreur serveur à l'envoi de la création                              | `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`                                       | 2026-08-04 |                                                                                                                                                                      |
| `reservation_viewed`                               | navigateur           | La fiche d'une réservation s'ouvre                                   | `apps/web/lib/product-analytics/reservation-analytics-client.ts`                                                     | 2026-08-05 |                                                                                                                                                                      |
| `reservation_action_started`                       | navigateur           | Le loueur lance une action sur une réservation                       | `apps/web/lib/product-analytics/reservation-analytics-client.ts`                                                     | 2026-08-05 |                                                                                                                                                                      |
| `reservation_action_succeeded`                     | navigateur + serveur | L'action a réussi                                                    | `reservation-analytics-client.ts`, et côté serveur `apps/web/lib/product-analytics/analytics.ts`                     | 2026-08-05 | Envoyé des deux côtés pour certaines actions : le serveur porte `source: server_mutation`. Le serveur ne l'envoie jamais pour une réservation test, le navigateur si |
| `reservation_action_failed`                        | navigateur + serveur | L'action a échoué                                                    | `reservation-analytics-client.ts`, `apps/web/app/api/reservations/[id]/contract/route.ts`                            | 2026-08-05 |                                                                                                                                                                      |
| `reservation_quick_actions_viewed`                 | navigateur           | Les actions rapides (mobile) s'affichent                             | `apps/web/lib/product-analytics/reservation-analytics-client.ts`                                                     | 2026-08-05 |                                                                                                                                                                      |
| `reservation_quick_action_clicked`                 | navigateur           | Une action rapide est cliquée                                        | `apps/web/lib/product-analytics/reservation-analytics-client.ts`                                                     | 2026-08-05 |                                                                                                                                                                      |

### Boutique en ligne et espace client

Détails : [reservations.md](reservations.md). Comptés sur le client final : anonyme côté
navigateur, `customers.id` côté serveur.

| Événement                         | Côté       | Quand                                                     | Où                                                                                                    | Sur `main` | Limites connues                                                                                                                              |
| --------------------------------- | ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout_step_viewed`            | navigateur | Une étape du checkout s'affiche                           | `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`                                         | 2026-08-04 |                                                                                                                                              |
| `checkout_step_validation_failed` | navigateur | La validation bloque une étape                            | `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`                                         | 2026-08-04 |                                                                                                                                              |
| `checkout_submit_failed`          | navigateur | L'envoi échoue                                            | `apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-submit.ts`                              | 2026-08-04 |                                                                                                                                              |
| `checkout_completed`              | navigateur | La réservation est envoyée (avant un éventuel Stripe)     | `apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-submit.ts`                              | 2026-08-04 | Même nom qu'un événement plus ancien des statistiques propres de la boutique (`storefront_events`, `/api/track`), qui ne va pas dans PostHog |
| `checkout_reservation_created`    | serveur    | La réservation est créée (boutique ou Booking API reeent) | `apps/web/lib/reservations/post-creation-effects.ts`                                                  | 2026-06-26 | Compté sur `customers.id`, pas sur le navigateur : le funnel se termine par `checkout_completed`                                             |
| `checkout_payment_started`        | serveur    | Le paiement en ligne commence                             | `apps/web/lib/reservations/start-checkout-payment.ts`, `apps/web/lib/reservations/payment-session.ts` | 2026-06-26 |                                                                                                                                              |
| `checkout_payment_completed`      | serveur    | Le paiement en ligne est confirmé                         | `apps/web/lib/reservations/complete-checkout-payment.ts`                                              | 2026-06-26 |                                                                                                                                              |
| `quote_accepted`                  | serveur    | Le client accepte un devis depuis son espace              | `apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/actions.ts`                    | 2026-07-02 | Seulement depuis l'espace client de la boutique                                                                                              |
| `quote_declined`                  | serveur    | Le client refuse un devis depuis son espace               | `apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/actions.ts`                    | 2026-07-02 | Seulement depuis l'espace client de la boutique                                                                                              |

`checkout_validation_recovered` est parti du 2026-08-11 au 2026-09-14 seulement : la refonte de
la boutique en ligne l'a retiré.

### Réservation test, offre d'abonnement, accueil

Détails : [test-reservation.md](test-reservation.md), [docs/domain/plan-offer.md](../domain/plan-offer.md),
[home.md](home.md).

| Événement                    | Côté             | Quand                                                       | Où                                                                                                                 | Sur `main` |
| ---------------------------- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| `test_reservation_started`   | serveur (outbox) | Le loueur lance une réservation test                        | `packages/api/src/services/test-reservations.ts`, envoyé par `apps/web/lib/test-reservations/lifecycle-effects.ts` | 2026-11-18 |
| `test_reservation_completed` | serveur          | La réservation test est passée sur la boutique              | `apps/web/lib/reservations/post-creation-effects.ts`                                                               | 2026-11-18 |
| `test_reservation_managed`   | serveur (outbox) | Le loueur change son statut ou fait un état des lieux       | `packages/api/src/services/reservation-status.ts`, `apps/web/lib/test-reservations/lifecycle.ts`                   | 2026-11-18 |
| `test_reservation_deleted`   | serveur (outbox) | Les données de test sont supprimées (à la main ou expirées) | `packages/api/src/services/test-reservations.ts`                                                                   | 2026-11-18 |
| `plan_offer_shown`           | serveur          | La carte de l'offre est vue sur l'accueil                   | `apps/web/lib/billing/plan-offer.ts`                                                                               | 2026-11-17 |
| `plan_offer_dismissed`       | serveur (outbox) | Le propriétaire ferme la carte                              | `packages/api/src/services/plan-offer.ts`, envoyé par `apps/web/lib/billing/plan-offer-effects.ts`                 | 2026-11-17 |
| `plan_offer_clicked`         | serveur (outbox) | Le Checkout de l'offre est ouvert                           | `packages/api/src/services/plan-offer.ts`, envoyé par `apps/web/lib/billing/plan-offer-effects.ts`                 | 2026-11-17 |
| `home_next_step_viewed`      | navigateur       | L'accueil montre sa carte de prochaine étape                | `apps/web/components/dashboard/home/home-next-step-viewed.tsx`                                                     | 2026-11-18 |

Limites : une réservation test n'envoie aucun des événements ordinaires d'une réservation. Les
cartes de l'accueil ne s'affichent plus que quand elles sont la prochaine étape depuis le
2026-11-18 : leurs événements sont plus rares depuis ([home.md](home.md)).

### Se faire connaître, liens partenaires

Détails : [visibility.md](visibility.md), [partners.md](partners.md). Tous navigateur, depuis
le dashboard.

| Événement                     | Quand                                                       | Où                                                                     | Sur `main` |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| `visibility_viewed`           | La page « Se faire connaître » ou sa carte est montrée      | `apps/web/components/dashboard/visibility/use-visibility-analytics.ts` | 2026-11-18 |
| `visibility_share_used`       | Le loueur ouvre un canal de partage ou copie un lien        | `apps/web/components/dashboard/visibility/use-visibility-analytics.ts` | 2026-11-18 |
| `visibility_step_completed`   | Il change le statut d'une étape                             | `apps/web/components/dashboard/visibility/use-visibility-analytics.ts` | 2026-11-18 |
| `visibility_ai_viewed`        | La page « Être trouvé par les IA » ou son résumé est montré | `apps/web/components/dashboard/visibility/use-visibility-analytics.ts` | 2026-11-19 |
| `visibility_ai_fix_opened`    | Il ouvre la page qui règle un point                         | `apps/web/components/dashboard/visibility/use-visibility-analytics.ts` | 2026-11-19 |
| `partners_viewed`             | La liste ou la fiche d'un partenaire est ouverte            | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |
| `partner_created`             | Un partenaire est ajouté                                    | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |
| `partner_link_shared`         | Le lien d'un partenaire est copié, enregistré ou envoyé     | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |
| `partner_month_paid`          | Un mois est marqué payé                                     | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |
| `partner_statement_exported`  | Le relevé d'un mois est exporté                             | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |
| `partner_reservation_changed` | Une réservation est attribuée, retirée ou ajustée           | `apps/web/components/dashboard/partners/use-partners-analytics.ts`     | 2026-11-25 |

Limite : la base reste la source de vérité de ces deux pages ; PostHog sert aux funnels.

### Parrainage

Arrivés sur `main` le 2026-06-23. Propriétés de base `feature: referral_program` et
`surface: app`, sans `analytics_area` ni `analytics_version` : les filtrer sur `feature`.

| Événement                               | Côté             | Quand                                                                     | Où                                                                             |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `referral_hub_viewed`                   | navigateur       | La page Parrainage s'ouvre                                                | `apps/web/app/(dashboard)/dashboard/referrals/referral-hub-viewed-tracker.tsx` |
| `referral_link_copied`                  | navigateur       | Le lien de parrainage est copié                                           | `apps/web/app/(dashboard)/dashboard/referrals/referral-link.tsx`               |
| `referral_link_copy_failed`             | navigateur       | La copie du lien échoue                                                   | `apps/web/app/(dashboard)/dashboard/referrals/referral-link.tsx`               |
| `referral_nudge_viewed`                 | navigateur       | L'encart de parrainage du dashboard est vu                                | `apps/web/components/dashboard/referral-nudge.tsx`                             |
| `referral_nudge_clicked`                | navigateur       | Il est cliqué                                                             | `apps/web/components/dashboard/referral-nudge.tsx`                             |
| `referral_nudge_dismissed`              | navigateur       | Il est fermé                                                              | `apps/web/components/dashboard/referral-nudge.tsx`                             |
| `referral_invite_landed`                | navigateur       | Une personne arrive sur la connexion par un lien de parrainage            | `apps/web/app/(auth)/login/_components/login-page-client.tsx`                  |
| `referral_store_attribution_resolved`   | serveur (outbox) | À la création d'une boutique, son parrainage est établi                   | `apps/web/lib/stores/store-creation-effects.ts`                                |
| `referral_referred_reward_granted`      | serveur (outbox) | La boutique parrainée reçoit sa récompense                                | `apps/web/lib/stores/store-creation-effects.ts`                                |
| `referral_qualifying_payment_evaluated` | serveur          | Un paiement en ligne de la boutique parrainée est examiné pour le parrain | `apps/web/lib/referral/rewards.ts`                                             |
| `referral_reward_granted`               | serveur          | Le parrain reçoit sa récompense                                           | `apps/web/lib/referral/rewards.ts`                                             |
| `referral_reward_clawback_evaluated`    | serveur          | Un remboursement ou un litige du paiement qualifiant est examiné          | `apps/web/lib/referral/rewards.ts`                                             |
| `referral_reward_clawed_back`           | serveur          | La récompense du parrain est reprise                                      | `apps/web/lib/referral/rewards.ts`                                             |

### Nouveautés et raccourcis clavier

Arrivés sur `main` le 2026-08-04. Tous navigateur, depuis le dashboard.

| Événement                            | Quand                                    | Où                                                                                                          |
| ------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `whats_new_list_viewed`              | La page des nouveautés s'ouvre           | `apps/web/app/(dashboard)/dashboard/whats-new/whats-new-page-content.tsx`                                   |
| `whats_new_announcement_viewed`      | Une annonce est vue                      | `apps/web/app/(dashboard)/dashboard/whats-new/whats-new-entry-analytics.tsx`                                |
| `whats_new_announcement_completed`   | Une annonce est lue jusqu'en bas         | `apps/web/app/(dashboard)/dashboard/whats-new/whats-new-entry-analytics.tsx`                                |
| `keyboard_shortcut_triggered`        | Un raccourci clavier est utilisé         | `apps/web/hooks/use-tracked-keyboard-shortcut.ts`, `apps/web/components/shared/dashboard-save-shortcut.tsx` |
| `keyboard_shortcut_settings_updated` | Les réglages des raccourcis sont changés | `apps/web/app/(dashboard)/dashboard/account/keyboard-shortcuts-settings.tsx`                                |

### Démo par métier

Détails : [demo-par-metier.md](../demo-par-metier.md). Serveur, envoyés par
`apps/web/lib/demo/demo-analytics.ts`, arrivés sur `main` le 2026-11-25. Comptés sur l'id
PostHog du visiteur laissé par le site, sinon sur l'id de sa démo, sans profil de personne.

| Événement             | Quand                                                       | Où (l'appel)                           |
| --------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `demo_started`        | La boutique de démo est ouverte                             | `apps/web/app/api/demo/start/route.ts` |
| `demo_step`           | Un pas du guide, la boutique ouverte, une réservation faite | `apps/web/app/api/demo/event/route.ts` |
| `demo_signup_clicked` | « Créer ma boutique gratuite »                              | `apps/web/app/demo/signup/route.ts`    |

### Événements propres à PostHog

| Événement                      | Côté       | Quand                                                                                                                                                       | Où                                         | Sur `main` |
| ------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| `$pageview`                    | navigateur | Chaque changement de page (dashboard et boutique), envoyé par l'app                                                                                         | `apps/web/components/posthog-provider.tsx` | 2026-01-27 |
| `$pageleave`                   | navigateur | La page est quittée                                                                                                                                         | `apps/web/lib/posthog-client.ts`           | 2026-01-27 |
| `$identify`                    | navigateur | Une page du dashboard, loueur connecté : `users.id`, avec e-mail et nom sur la personne                                                                     | `apps/web/components/posthog-provider.tsx` | 2026-01-27 |
| Autocapture, replay de session | navigateur | Dashboard seulement depuis le 2026-07-02, selon les réglages du projet PostHog                                                                              | `apps/web/lib/posthog-client.ts`           | 2026-01-27 |
| `$exception`                   | serveur    | Une exception non gérée ou une erreur 5xx, nettoyée ; éteint sans `POSTHOG_ERROR_TRACKING_ENABLED` ([error-tracking.md](../architecture/error-tracking.md)) | `apps/web/lib/error-tracking.ts`           | 2026-11-10 |

Limite : depuis le 2026-07-02, la boutique en ligne garde le visiteur en mémoire seulement ; un
rechargement complet de la page en fait un nouvel anonyme.

## Related

- [lifecycle.md](lifecycle.md) — attribution à l'inscription, conversion « Compte créé », étapes d'une boutique.
- [store-setup.md](store-setup.md) — mise en place d'une boutique par un agent ou un humain.
- [reservations.md](reservations.md) — création de réservation, checkout, canal reeent.
- [test-reservation.md](test-reservation.md), [home.md](home.md), [visibility.md](visibility.md), [partners.md](partners.md).
- [docs/demo-par-metier.md](../demo-par-metier.md) — la démo et ses événements.
