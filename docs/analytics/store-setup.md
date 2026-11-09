# Analytics — Mise en place d'une boutique (agents et humains)

Instrumentation PostHog de la mise en place d'une boutique (novembre 2026) : quelle boutique
a été montée par un agent (Claude, ChatGPT…), ce qu'il a renseigné, jusqu'où il est allé, et si
la boutique a été mise en ligne. Le code est dans `packages/api/src/platform/setup-analytics.ts`
(ce qui part) et `apps/web/lib/product-analytics/setup-analytics.ts` (les propriétés PostHog).

Tous les événements sont serveur, envoyés par l'outbox (`api_effects`) : un UUID et une date
fixés à l'écriture, donc un seul événement PostHog même après un nouvel essai. Ils portent les
propriétés de base `analytics_area: core_product` et `analytics_version: 1`, et le distinct_id
du propriétaire de la boutique (`stores.user_id`), comme les autres événements d'onboarding.
Sans PostHog configuré (`NEXT_PUBLIC_POSTHOG_KEY` absent), la ligne est marquée `skipped` et
rien ne part.

## Qui a agi

Chaque événement nomme qui a fait l'écriture :

| Propriété         | Valeurs                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential_kind` | `session` (un humain dans le dashboard), `api_key`, `oauth` (un agent)                                                                                                                                                                                                                                                                                                                   |
| `agent_client`    | Agents seulement : `claude`, `chatgpt`, `le_chat`, `gemini`, `grok`, `perplexity`, `copilot`, `cursor`, `n8n`, `make`, `zapier` ou `other`, déduit du nom du client OAuth ou de la clé par une table fixe. Le nom lui-même n'est jamais envoyé : un client OAuth le déclare et l'utilisateur tape celui d'une clé, tous deux peuvent contenir n'importe quoi, un nom de personne compris |

## Événements

| Événement                     | Quand                                                                                                                                                                                                                                                              | Propriétés                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_store_setup_action`    | Chaque écriture réussie d'un agent (clé API ou OAuth) sur une boutique encore hors ligne, dans les domaines boutique, réglages, boutique en ligne, produits, catégories, champs client ; et sa mise en ligne. Pas sur un rejeu idempotent, ni sur un aperçu refusé | `feature: store_setup`, `surface` et `transport` (`mcp`, `openapi`), `actor: agent`, `store_id`, `procedure` (`stores.create`, `settings.updateStoreInfo`, `onlineStore.updateAppearance`, `products.create`, `stores.completeOnboarding`…), qui a agi, `confirmation_accepted`, `fields_set`, `fields_set_count`, `fields_cleared`, et les faits ci-dessous |
| `onboarding_store_info_saved` | Préexistant. Création de la boutique (`stores.create`), ou étape « boutique » du wizard sur une boutique incomplète                                                                                                                                                | En plus des propriétés existantes : `store_created_by` (`human`, `agent`), `credential_kind`, et pour un agent `agent_client`                                                                                                                                                                                                                                |
| `onboarding_completed`        | Préexistant. Mise en ligne (`stores.completeOnboarding`), par le wizard ou un agent                                                                                                                                                                                | En plus de `store_id`, `reservation_mode` : qui l'a mise en ligne, et `setup_by`, `store_created_by`, `agent_action_count`, `human_action_count`, `agent_clients`, `seconds_to_launch` (ci-dessous)                                                                                                                                                          |

`confirmation_accepted` vaut `true` quand l'appel a renvoyé le jeton d'une confirmation : l'agent
a reçu l'aperçu (`CONFIRMATION_REQUIRED`) et l'a accepté. `fields_set` liste les noms des champs
envoyés avec une valeur, `fields_cleared` ceux envoyés à `null` : des noms (`email`, `phone`),
jamais les valeurs.

### Les faits d'une action

Uniquement des codes, des énumérations, des nombres et des oui/non (`SETUP_FACT_KEYS`) :

| Procédure                                                  | Faits                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stores.create`                                            | `country`, `currency`, `has_address`, `has_coordinates`, `has_email`, `has_phone`                                                                                                                                            |
| `settings.updateStoreInfo`                                 | `has_coordinates`                                                                                                                                                                                                            |
| `settings.updateCompany`                                   | `country`, `currency`, `billing_address_same_as_store`                                                                                                                                                                       |
| `settings.updateReservationRules`                          | `reservation_mode`, `online_payment_deposit_percentage`                                                                                                                                                                      |
| `settings.updateBusinessHours`                             | `business_hours_enabled`, `days_changed_count`, `open_days_count`, `closure_count`                                                                                                                                           |
| `settings.updateDelivery`                                  | `delivery_enabled`, `delivery_mode`                                                                                                                                                                                          |
| `onlineStore.updateAppearance`                             | `theme_mode`, `has_logo`, `has_dark_logo`, `has_favicon`, `hero_image_count`, `hero_layout`, `catalog_browse_mode`                                                                                                           |
| `onlineStore.createImageUpload`, `completeImageUpload`     | `image_kind`                                                                                                                                                                                                                 |
| `products.create`, `products.update`                       | `product_status`, `pricing_kind`, `stock_kind`, `has_price`, `has_deposit` (caution renseignée), `pricing_tier_count`, `image_count`, `unit_count`, `variant_axis_count`, `accessory_count`, `category_count`, `track_units` |
| `products.ensureVariantDefinition`                         | `variant_value_count`                                                                                                                                                                                                        |
| `stores.completeOnboarding`                                | `reservation_mode`, `booking_mode_effective`                                                                                                                                                                                 |
| Les autres (textes légaux, catégories, points de retrait…) | Les noms de champs seuls                                                                                                                                                                                                     |

Un fait n'apparaît que si l'appel touche son champ.

### Le résumé à la mise en ligne

Calculé dans la transaction de la mise en ligne, depuis le journal des écritures
(`api_operations`) : la création de la boutique et chaque écriture de mise en place réussie
avant la mise en ligne, celle-ci comprise.

| Propriété            | Sens                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `setup_by`           | `human` (aucune action d'agent), `agent` (aucune action humaine), `mixed`  |
| `store_created_by`   | `agent` si `stores.create` est venu d'une clé ou d'un jeton, sinon `human` |
| `agent_action_count` | Écritures d'agents                                                         |
| `human_action_count` | Écritures d'une session du dashboard                                       |
| `agent_clients`      | Les `agent_client` des agents qui ont agi, triés                           |
| `seconds_to_launch`  | De la création de la boutique à la mise en ligne, sur l'horloge de la base |

Les étapes du wizard qui n'appellent pas encore une procédure (l'étape « boutique » sur une
boutique existante) ne laissent pas de trace dans `api_operations` et ne comptent pour
personne ; la mise en ligne par le wizard, elle, compte comme action humaine.

## Données personnelles

Aucune valeur saisie par une personne ne part : ni nom, e-mail, téléphone, adresse, identité
légale, ni texte libre. Deux tests le gardent :

- `packages/api/src/platform/setup-analytics.test.ts` envoie des valeurs personnelles dans
  chaque champ de chaque procédure et vérifie qu'aucun fait ne les contient, que chaque fait
  est dans `SETUP_FACT_KEYS` et qu'un nom de champ est un identifiant (une clé saisie par une
  personne est écartée) ;
- `apps/web/lib/stores/store-setup-effects.test.ts` tient la liste des propriétés permises par
  événement et échoue sur une propriété inattendue ou une valeur qui ressemble à un e-mail ou
  à un téléphone. Une nouvelle propriété s'ajoute là, et dans ce document.

## Exemples d'analyses

- Funnel `agent_store_setup_action` (procedure = `stores.create`) → `onboarding_completed`,
  ventilé par `agent_client`.
- `onboarding_completed` ventilé par `setup_by` ; médiane de `seconds_to_launch` par `setup_by`.
- Boutiques créées par un agent et terminées par un humain : `onboarding_completed` avec
  `store_created_by = agent` et `setup_by = mixed`.
- Ce que les agents remplissent : `agent_store_setup_action` ventilé par `procedure`, puis par
  `fields_set`.
