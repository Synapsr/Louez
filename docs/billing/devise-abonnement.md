# Devise des abonnements Pro et Ultra

Une boutique qui prend un abonnement doit être facturée dans sa propre devise
(`stores.settings.currency`). Jusqu'ici, tout partait en euros ou en dollars, selon la langue de
l'interface. Ce document décrit l'état d'avant, le choix technique et ce qui reste à décider.
Il ne contient aucun chiffre de production : le dépôt est public.

## 1. Avant ce changement

### Comment la devise était choisie

La grille des plans (`app/(dashboard)/dashboard/subscription/subscription-management.tsx`)
avait un sélecteur EUR / USD. Sa valeur par défaut :

- un abonnement en cours gardait sa devise (Stripe ne la change pas) ;
- sinon, **la langue de l'interface** décidait : EUR en français, USD dans toutes les autres
  langues.

La devise de la boutique n'était jamais lue. Le navigateur envoyait la devise choisie à
`createCheckoutSession`, qui ouvrait Stripe Checkout avec le prix de cette devise.

Pourquoi une boutique hors zone euro finissait en euros : `Currency` ne connaissait que `eur`
et `usd`. Une boutique en GBP, CHF ou CAD avec une interface en français voyait EUR par
défaut ; avec une autre langue, elle voyait USD, pas sa devise. Aucune autre devise n'avait de
prix Stripe ni de variable d'environnement.

### Le chemin USD, de bout en bout

| Étape                                    | État                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables d'environnement                | `STRIPE_PRICE_{PRO,ULTRA}_{MONTHLY,YEARLY}_USD` sont déclarées dans `env.ts` et lues par `getPlans()` (`lib/plans.ts`), comme les quatre variables EUR.                                                                                                                                   |
| Checkout                                 | `createSubscriptionCheckoutSession` prend le prix de la devise reçue. Fonctionne en USD.                                                                                                                                                                                                  |
| Changement de plan, proratisation        | `planChangeTarget` refuse une devise autre que celle de l'abonnement (`SubscriptionPlanError('currency')`) ; la proratisation est celle de Stripe, sur le prix de la même devise. Fonctionne en USD.                                                                                      |
| Webhooks, plan en vigueur                | `findPlanPrice` retrouve le plan, l'intervalle et la devise d'un prix. Fonctionne en USD.                                                                                                                                                                                                 |
| Offre contextuelle (#210)                | Lit la devise de la boutique et propose un plan seulement si un prix mensuel existe dans cette devise ; sinon, exclusion `currency`. EUR et USD seulement. Le prix comparé était `plan.price`, le même nombre dans toutes les devises.                                                    |
| Coupons admin                            | `percent_off` sans devise : valables dans toutes les devises.                                                                                                                                                                                                                             |
| Code promo BF2026-40                     | Absent du code et du compte Stripe de test. Checkout accepte les codes promo (`allow_promotion_codes`) quand la boutique n'a pas de coupon admin. Un coupon `percent_off` vaut dans toutes les devises ; un coupon `amount_off` ne vaut que dans sa devise, sauf avec `currency_options`. |
| Factures                                 | Émises par Stripe dans la devise de l'abonnement.                                                                                                                                                                                                                                         |
| Affichage sur la page Abonnement         | `formatPrice` : `49€` ou `$49`, avec `plan.price` (USD = EUR 1:1, comme le site).                                                                                                                                                                                                         |
| Service de facturation (`louez-billing`) | Il reçoit le plan de la boutique (slug, statut, client Stripe, README §8.7), pas sa devise. La commission de 4 % est déjà facturée dans la devise de la boutique. Rien à changer côté service.                                                                                            |

Le compte Stripe de test a ses huit prix (EUR et USD, mensuel et annuel), un produit par plan
et un prix par devise. Les prix live n'ont pas été lus.

## 2. Les devises des boutiques

La vitrine accepte une quarantaine de devises (`lib/utils/currency.ts`). Le nombre de boutiques
par devise demande une lecture de la base de production, que Téo autorise au cas par cas. La
requête, en lecture seule :

```sql
SELECT UPPER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(settings, '$.currency')), 'EUR')) AS currency,
       COUNT(*) AS stores
FROM stores
GROUP BY currency
ORDER BY stores DESC;
```

Les résultats restent hors du dépôt (`.agent-docs/`).

## 3. Prix séparés ou un prix multidevise

| Critère                   | Un prix par devise (choix actuel)                                                                                                   | Un prix avec `currency_options`                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Choix de la devise        | Louez choisit le prix, donc la devise. Rien n'est laissé à Stripe.                                                                  | Stripe choisit l'option d'après la localisation du client, sauf si Checkout reçoit `currency`. Il faudrait toujours l'envoyer.                                                                               |
| Code                      | Déjà en place (`stripePrices`, `findPlanPrice`, webhooks, analytics). Une devise de plus = quatre variables et une entrée de liste. | Un seul identifiant par plan et par intervalle. La devise ne se déduit plus du prix mais de l'abonnement : il faut migrer `findPlanPrice`, le webhook, les analytics et les prix EUR/USD live déjà utilisés. |
| Coupons                   | `percent_off` : aucune différence. `amount_off` : un coupon par devise ou `currency_options` sur le coupon.                         | Pareil : la règle tient au coupon, pas au prix.                                                                                                                                                              |
| Proratisation, changement | Le changement prend le prix de la devise de l'abonnement ; Stripe refuse de mélanger deux devises dans un abonnement.               | L'abonnement garde sa devise et utilise l'option correspondante. Même règle : un abonnement ne change jamais de devise.                                                                                      |
| Lecture des montants      | Un prix = un montant.                                                                                                               | Il faut lire `currency_options` (avec `expand`).                                                                                                                                                             |
| Risque                    | Une variable mal recopiée (prix d'une autre devise, autre intervalle). Louez le détecte : voir 4.2.                                 | Une option oubliée : Stripe facture dans la devise par défaut du prix, sans le dire à Louez.                                                                                                                 |

Recommandation : garder un prix par devise. Le code et les prix live suivent déjà ce modèle,
et Louez fixe la devise lui-même au lieu de laisser Stripe la déduire.

## 4. Ce que fait le code maintenant

### 4.1 Règle

- Devises possibles pour un abonnement : `PLAN_CURRENCIES` (`lib/plans.shared.ts`) = EUR, USD,
  GBP, CHF, CAD.
- Une boutique est facturée dans sa devise **si chaque plan payant a ses deux prix (mensuel et
  annuel) dans cette devise** et que Stripe les confirme (4.2). Sinon, en EUR, comme avant
  pour une interface en français (`planCurrencyFor`, `getStorePlanPricing`).
- Le sélecteur EUR / USD disparaît : le serveur choisit la devise. `createCheckoutSession`
  ignore toute devise envoyée par le navigateur.
- Un abonnement en cours garde sa devise. Un changement de plan reste dans cette devise.
- Une ligne sous le titre des plans l'explique quand la devise affichée n'est pas celle de la
  boutique : « Prix en EUR : les abonnements ne sont pas encore facturés en GBP. » ou
  « Votre abonnement est facturé en USD. »

Sans nouvelle variable d'environnement, une boutique en EUR ou en USD est facturée dans sa
devise, et toute autre en EUR. Seul changement visible : une boutique en EUR dont l'interface
n'est pas en français ne se voit plus proposer USD par défaut.

### 4.2 Montants affichés

- EUR et USD : `plan.price` du code (`CODE_PRICED_CURRENCIES`), mensuel ×10 pour l'année, comme
  le site.
- GBP, CHF, CAD : les montants des prix Stripe (`lib/billing/plan-pricing.ts`), lus une fois
  toutes les dix minutes par processus. La page n'affiche donc jamais un montant que Stripe ne
  facturerait pas.
- Un prix introuvable, archivé, dans une autre devise, avec un autre intervalle ou sans montant
  fixe empêche de vendre dans cette devise : la boutique reste en EUR et un avertissement est
  journalisé (`planPricingFromStripe`).
- L'offre contextuelle compare ce que la boutique a payé avec le prix du plan **dans sa
  devise** ; sans prix vendable dans sa devise, pas d'offre (exclusion `currency`, comme avant).

### 4.3 Ajouter une devise plus tard

1. Ajouter le code à `PLAN_CURRENCIES` (`lib/plans.shared.ts`).
2. Déclarer les quatre variables `STRIPE_PRICE_{PRO,ULTRA}_{MONTHLY,YEARLY}_<CODE>` dans
   `apps/web/env.ts`, `getPlans()` (`lib/plans.ts`) et `.env.example`.
3. Créer les prix dans Stripe et remplir les variables (section 6).

## 5. Décisions pour Téo

### 5.1 Devises au lancement

| Devise | Proposition                             | À trancher                                          |
| ------ | --------------------------------------- | --------------------------------------------------- |
| EUR    | Inchangé                                | —                                                   |
| USD    | Inchangé (prix déjà en live)            | Garder 1:1 avec EUR ?                               |
| GBP    | Candidate                               | Oui / non, selon le nombre de boutiques (section 2) |
| CHF    | Candidate                               | Oui / non, selon le nombre de boutiques             |
| CAD    | Candidate                               | Oui / non, selon le nombre de boutiques             |
| Autre  | Hors code ; ajout en trois étapes (4.3) | D'après les comptages                               |

### 5.2 Grille de prix, HT

Taux de référence BCE du 18 novembre 2026 : 1 EUR = 1,0968 USD = 0,8329 GBP = 0,9243 CHF =
1,5690 CAD. Les colonnes « équivalent » sont la conversion brute ; Téo choisit le montant final.
L'annuel vaut dix mois : le badge « -17 % » de la page est écrit en dur, il faut garder ce
rapport.

| Plan        | EUR (actuel) | USD (actuel, 1:1) | Équivalent USD | GBP 1:1 | Équivalent GBP | CHF 1:1   | Équivalent CHF | CAD 1:1  | Équivalent CAD |
| ----------- | ------------ | ----------------- | -------------- | ------- | -------------- | --------- | -------------- | -------- | -------------- |
| Pro mensuel | 49 €         | $49               | $53.74         | £49     | £40.81         | CHF 49    | CHF 45.29      | CA$49    | CA$76.88       |
| Pro annuel  | 490 €        | $490              | $537.43        | £490    | £408.12        | CHF 490   | CHF 452.91     | CA$490   | CA$768.81      |
| Ultra mens. | 159 €        | $159              | $174.39        | £159    | £132.43        | CHF 159   | CHF 146.96     | CA$159   | CA$249.47      |
| Ultra ann.  | 1 590 €      | $1,590            | $1,743.91      | £1,590  | £1,324.31      | CHF 1,590 | CHF 1,469.64   | CA$1,590 | CA$2,494.71    |

Autres décisions :

- **Site marketing** : il montre USD = EUR 1:1 hors Europe. Avec GBP, CHF ou CAD, faut-il y
  afficher les prix locaux ?
- **Codes promo** : BF2026-40 et les suivants doivent être des coupons `percent_off` sans
  restriction de devise, sinon ils ne valent qu'en EUR. À vérifier dans Stripe live.
- **Boutiques déjà abonnées en EUR ou USD hors de leur devise** : elles le restent. Les passer
  dans leur devise demande un nouvel abonnement ; rien n'est fait sans décision.

## 6. À faire à la main dans Stripe live (après accord de Téo)

Pour chaque devise retenue, sur les deux produits existants (Pro, Ultra), pas de nouveau
produit :

1. Créer quatre prix récurrents : Pro mensuel, Pro annuel, Ultra mensuel, Ultra annuel, dans la
   devise, au montant décidé, avec le même `tax_behavior` que les prix EUR live (la
   facturation active `automatic_tax`).
2. Renseigner les variables de l'app de production, puis redéployer :
   - `STRIPE_PRICE_PRO_MONTHLY_<CODE>`
   - `STRIPE_PRICE_PRO_YEARLY_<CODE>`
   - `STRIPE_PRICE_ULTRA_MONTHLY_<CODE>`
   - `STRIPE_PRICE_ULTRA_YEARLY_<CODE>`

   `<CODE>` vaut `GBP`, `CHF` ou `CAD`. Les mêmes clés vont dans Infisical (`dev` avec des prix
   de test, `prod`).

3. Vérifier les codes promo actifs (`percent_off`, pas de restriction de devise).
4. Ouvrir la page Abonnement d'une boutique de test dans cette devise : les montants doivent
   être ceux des prix créés. S'ils sont en EUR, les journaux disent quel prix pose problème
   (`plan prices in GBP cannot sell a plan …`).

Tant qu'une des quatre variables manque, les boutiques de cette devise restent en EUR.

## Related

- [docs/domain/plan-offer.md](../domain/plan-offer.md) : l'offre contextuelle, qui compare dans la devise de la boutique.
- `louez-billing` `docs/api/README.md` §8.7 : ce que le service sait du plan d'une boutique.
