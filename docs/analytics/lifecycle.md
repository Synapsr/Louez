# Analytics — Cycle de vie d'un compte loueur

Ce que devient un compte selon sa source (novembre 2026) : d'où il vient, puis s'il crée sa
boutique, la met en ligne, connecte Stripe, encaisse, et prend un abonnement Pro ou Ultra.
Tous les événements de ce document sont serveur et comptés sur le **loueur** : le distinct_id
de l'utilisateur (`users.id`), pour une boutique celui de son propriétaire (`stores.user_id`).
Les étapes intermédiaires déjà instrumentées (`onboarding_*`, `product_created`,
`dashboard_reservation_created`) sont décrites dans [store-setup.md](store-setup.md) et
[reservations.md](reservations.md).

Sans PostHog configuré (`NEXT_PUBLIC_POSTHOG_KEY` absent, cas de l'auto-hébergement), rien ne
part et rien ne plante : le client serveur est un no-op et les lignes d'outbox sont marquées
`skipped`. Sans le cookie du site, l'inscription marche comme avant et vaut `direct`.

## Attribution à l'inscription : `account_created`

Le site louez.io pose le cookie `louez_attribution` (`Domain=.louez.io`, httpOnly, 90 jours) :
un objet JSON en base64url, aux clés toutes optionnelles `utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`, `gad_source`, `fbclid`,
`landing_path`, `referrer_domain`, `ts`. L'app le lit côté serveur une seule fois, dans le hook
de création de l'utilisateur (`apps/web/lib/auth.ts`), sur la requête qui crée le compte : la
vérification du code e-mail ou le retour de Google. Le cookie y arrive tant que le site le pose
en `SameSite=Lax` (le défaut) ou `None` : le retour de Google est une navigation de premier
niveau.

Le cookie vient d'un navigateur, rien n'y est cru (`apps/web/lib/acquisition/first-touch.ts`) :
une valeur qui ne se décode pas en objet vaut « pas de cookie », une clé inconnue est ignorée,
chaque valeur est une chaîne imprimable d'au plus 255 caractères, une valeur qui contient une
adresse e-mail (même encodée : `%40`, `%2540`, `(at)`) est écartée, `landing_path` perd sa query
et son fragment, `referrer_domain` doit être un nom de domaine. Les valeurs `utm_*` sont les noms
de campagne de l'annonceur : aucun filtre ne reconnaît un nom de personne qu'on y aurait tapé,
les liens de campagne ne doivent donc pas en porter.

| Propriété                                                                      | Sur l'événement | Sur la personne (`$set_once`) |
| ------------------------------------------------------------------------------ | --------------- | ----------------------------- |
| `first_touch_<clé>` pour chaque clé présente du cookie (`first_touch_gclid`…)  | oui             | oui                           |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid` | oui, si présent | **non**                       |
| `acquisition_channel` (canal dérivé, ci-dessous)                               | oui             | non                           |
| `first_touch_acquisition_channel` (le même canal)                              | non             | oui                           |
| `attribution_cookie_present`                                                   | oui             | non                           |

Les noms UTM standards et `gclid` sont recopiés sur l'événement parce que le module Marketing
Analytics de PostHog rapproche les dépenses Google Ads des conversions par `utm_campaign` (et
`utm_source`…) sur l'événement de conversion : sans eux, pas de coût par compte. Ils ne vont
pas sur la personne : les `utm_*` d'une personne y sont ceux de sa dernière visite, que PostHog
pose lui-même. Sur la personne, le canal s'appelle `first_touch_acquisition_channel`, car
`acquisition_channel` y est déjà la réponse du loueur à « comment nous avez-vous connus ? »
(`acquisition_channel_reported`).

Un compte créé sans requête (un script) n'a aucune de ces propriétés.

### Le canal dérivé

Dans l'ordre, le premier qui s'applique :

| Canal          | Quand                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `google_ads`   | `gclid`, `gbraid`, `wbraid` ou `gad_source`, ou `utm_source` google et `utm_medium` payant (`cpc`, `ppc`, `paid`, `paidsearch`, `sem`…) |
| `meta_ads`     | `fbclid`, ou `utm_medium` `paid_social`, ou `utm_source` facebook/instagram/meta et `utm_medium` payant                                 |
| `ai_assistant` | `utm_source` ou `referrer_domain` d'un assistant : chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot, Mistral…          |
| `organic`      | `utm_medium=organic`, ou sans `utm_source` un `referrer_domain` de moteur (google.\*, bing, duckduckgo, ecosia, qwant…)                 |
| `referral`     | Tout autre `utm_source`, `utm_medium` ou `referrer_domain` (hors louez.io)                                                              |
| `direct`       | Ni cookie, ni rien de ce qui précède                                                                                                    |

### En base

`users.first_touch_attribution` (JSON) garde le canal (`channel`) et les champs du cookie, une
seule fois, jamais par-dessus une valeur déjà là : pour une future conversion Google Ads côté
serveur, qui a besoin du `gclid` (ou `gbraid`/`wbraid`). Distinct de `users.acquisition_channel`,
la réponse déclarée.

Exemple d'`account_created` avec un cookie Google Ads :

```json
{
  "event": "account_created",
  "distinct_id": "<users.id>",
  "properties": {
    "analytics_area": "core_product",
    "analytics_version": 1,
    "feature": "authentication",
    "surface": "dashboard",
    "source": "auth_database_hook",
    "first_touch_utm_source": "google",
    "first_touch_utm_medium": "cpc",
    "first_touch_utm_campaign": "fr-search-location",
    "first_touch_gclid": "EAIaIQobChMI…",
    "first_touch_gad_source": "1",
    "first_touch_landing_path": "/fr/logiciel-location",
    "first_touch_ts": "2026-11-17T10:42:05.123Z",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "fr-search-location",
    "gclid": "EAIaIQobChMI…",
    "acquisition_channel": "google_ads",
    "attribution_cookie_present": true,
    "$set_once": {
      "first_touch_utm_source": "google",
      "first_touch_utm_medium": "cpc",
      "first_touch_utm_campaign": "fr-search-location",
      "first_touch_gclid": "EAIaIQobChMI…",
      "first_touch_gad_source": "1",
      "first_touch_landing_path": "/fr/logiciel-location",
      "first_touch_ts": "2026-11-17T10:42:05.123Z",
      "first_touch_acquisition_channel": "google_ads"
    }
  }
}
```

## Les étapes d'une boutique

Envoyées par l'outbox (`api_effects`, ligne `store.lifecycleAnalytics`) : un UUID et une date
fixés à l'écriture, donc un seul événement PostHog même après un nouvel essai. La ligne est
ajoutée dans la transaction de l'écriture qui cause l'événement (mise en ligne, colonnes
Stripe Connect, ligne d'abonnement) : elle existe si et seulement si l'écriture est validée.
Celles d'abonnement partent par le cron de l'outbox, en une à deux minutes. Celles qui viennent
d'un webhook Stripe ont un UUID dérivé du fait lui-même (l'événement Stripe, l'abonnement, le
PaymentIntent) et la date de Stripe : un webhook redélivré ne compte pas deux fois.
`subscription_started` et `subscription_canceled` sont en plus décidés sous le verrou de la ligne
d'abonnement : un checkout redélivré après un changement de plan trouve l'abonnement déjà en
place et ne compte rien (il ne décrirait pas le plan d'origine), une suppression redélivrée
trouve la ligne déjà terminée. Toutes portent `analytics_area: core_product`, `analytics_version: 1`,
`feature: account_lifecycle`, `surface: server` et `store_id`.

| Événement                  | Quand                                                                                                                                                                                                                                                                                                                                                                                                 | Propriétés                                                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store_published`          | La boutique passe en ligne : `stores.onboarding_completed` devient vrai par `goLive` (`packages/api/src/services/launch.ts`), depuis le wizard ou un agent. Une boutique ne repasse jamais hors ligne : une fois par boutique. Même instant que `onboarding_completed`                                                                                                                                | `reservation_mode` (voulu), `booking_mode_effective` (`request` tant que Stripe n'encaisse pas), `transport` (`rpc`, `openapi`, `mcp`), `setup_by` ([store-setup.md](store-setup.md))                                                                                                            |
| `stripe_connect_completed` | La première écriture qui trouve `charges_enabled` : le webhook `account.updated` ou une synchro du statut. Une seule fois par boutique (`stores.stripe_connect_completed_at`), même si le compte est désactivé puis réactivé, ou remplacé. Les boutiques déjà connectées ou qui ont déjà encaissé par Stripe avant ne la comptent pas                                                                 | `details_submitted`, `seconds_since_store_created`                                                                                                                                                                                                                                               |
| `subscription_started`     | Un plan acheté par Checkout et écrit sur la boutique (`checkout.session.completed` du webhook plateforme), quand la ligne prend l'abonnement. Une fois par abonnement Stripe                                                                                                                                                                                                                          | `plan` (`pro`, `ultra`), `interval` (`monthly`, `yearly`), `amount_cents` (par période), `mrr_cents`, `currency`, `subscription_status`, `is_trial`                                                                                                                                              |
| `subscription_changed`     | Un `customer.subscription.updated` qui change le plan, selon ce que Stripe dit avoir changé. Une fois par événement Stripe. Pas sur un renouvellement ni une relance de paiement                                                                                                                                                                                                                      | `change_type` (`plan`, `interval`, `price`, `cancellation_scheduled`, `cancellation_reverted`, `trial_converted`), les propriétés de prix ci-dessus, et pour un changement de prix `previous_plan`, `previous_interval`, `previous_amount_cents` ; `subscription_status`, `cancel_at_period_end` |
| `subscription_canceled`    | L'abonnement est terminé (`customer.subscription.deleted`) et la boutique revient au paiement à l'usage. Une fois par abonnement                                                                                                                                                                                                                                                                      | Les propriétés de prix, `cancellation_reason` (de Stripe : `cancellation_requested`, `payment_failed`, `payment_disputed`), `owner_scheduled_switch` (le loueur a choisi le paiement à l'usage depuis sa page)                                                                                   |
| `payg_fee_charged`         | La commission de réservation d'un paiement en ligne, prélevée à la source en frais d'application Stripe (webhook Connect `checkout.session.completed`, réservation ou prolongation), lue dans les faits de frais du paiement : que la boutique soit facturée par le service (`store`, `default`) ou par l'ancien calcul (`legacy`), et quel que soit son mode aujourd'hui. Une fois par PaymentIntent | `reservation_id`, `fee_cents` (la commission de réservation), `currency`, `collection: application_fee`, `application_fee_cents` (tout ce que Stripe a prélevé, marketplace compris), `payment_amount_cents`, `policy_scope`                                                                     |

La vérité des abonnements est dans l'app : la table `subscriptions`, écrite par le webhook
Stripe de la plateforme (`apps/web/lib/stripe/subscription-webhooks.ts`) et par la page
d'abonnement. Le service de facturation (louez-billing) n'en reçoit qu'une copie.

`checkout_payment_completed.application_fee_collected_cents` ne suffit pas pour le paiement à
l'usage : il est compté sur le client final, n'est renseigné que si le webhook confirme le
paiement avant la page de retour, et mêle la commission de la marketplace reeent. D'où
`payg_fee_charged`. Les commissions des réservations payées hors ligne ne sont pas prélevées
par l'app : le service de facturation les facture à la fin du mois, c'est à lui de les compter.

## Le groupe `store`

Tout événement serveur qui a un `store_id` porte aussi le groupe PostHog
`$groups: { store: <store_id> }` (`withStoreGroup` dans
`apps/web/lib/product-analytics/analytics.ts`) : les événements des clients finaux
(`checkout_*`) et ceux du loueur se lisent ensemble par boutique, si les groupes sont activés
dans le projet PostHog. Sans eux, `checkout_reservation_created` et `checkout_payment_completed`
portent `merchant_distinct_id`.

## Données personnelles

Aucun nom, e-mail, téléphone ni texte libre : des codes, des montants, des oui/non, et les
valeurs du cookie après le filtre ci-dessus. Les tests :

- `apps/web/lib/acquisition/first-touch.test.ts` : cookie absent, invalide, valide, filtre,
  canal, propriétés de `account_created` ;
- `apps/web/lib/stripe/subscription-analytics.test.ts` : quel changement d'abonnement compte ;
- `apps/web/lib/billing/legacy-guard.db.test.ts` : début et fin d'un abonnement comptés une fois,
  redélivrance comprise ;
- `apps/web/lib/pay-as-you-go/payg-fee-analytics.test.ts` : la commission, quelle que soit la
  politique de facturation ;
- `packages/api/src/services/stripe-connect.db.test.ts` : `stripe_connect_completed` une fois ;
- `apps/web/lib/stores/store-lifecycle-effects.test.ts` : le sender de l'outbox.

## Exemples d'analyses

- Funnel par `first_touch_acquisition_channel` (propriété de personne) : `account_created` →
  `onboarding_store_info_saved` → `product_created` → `store_published` →
  `stripe_connect_completed` → `dashboard_reservation_created` → `payg_fee_charged` ou
  `subscription_started`.
- Coût par compte Google Ads : Marketing Analytics, conversion `account_created`, par
  `utm_campaign`.
- Revenu d'une campagne : somme de `payg_fee_charged.fee_cents` et `subscription_started.mrr_cents`
  par `first_touch_utm_campaign`.
