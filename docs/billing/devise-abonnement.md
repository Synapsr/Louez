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

## 3. Le choix : un prix multidevise (`currency_options`)

| Option                                                       | Prix pour le client                                                 | À configurer                                        | Retenue |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------- | ------- |
| Adaptive Pricing (conversion Stripe)                         | Converti au taux du jour, 2 à 4 % de frais, varie à chaque échéance | Rien                                                | Non     |
| Un prix par devise                                           | Fixe                                                                | Quatre prix et quatre variables par devise          | Non     |
| Un prix avec `currency_options` (« manual currency prices ») | Fixe                                                                | Un montant par devise sur les quatre prix existants | **Oui** |

Avec `currency_options`, chaque prix (Pro et Ultra, mensuel et annuel) reste en EUR par défaut
et porte un montant fixe par autre devise. Stripe documente cette méthode pour afficher des prix
fixes en monnaie locale. Une devise s'ajoute dans Stripe, sans variable ni déploiement.

Ce que Stripe en fait, vérifié sur le compte de test le 19 novembre 2026 :

- On peut ajouter des options à un prix existant, déjà utilisé par des abonnements.
- **Une option ne se modifie ni ne se retire** : Stripe refuse de changer le montant d'une
  devise déjà présente sur un prix (« immutable field for an existing currency »). Le montant de
  chaque devise est donc définitif sur ces quatre prix (4.4).
- Checkout reçoit le prix et `currency` : sans ce paramètre, il prendrait la devise du client.
- L'abonnement garde sa devise pour toujours (`subscription.currency`). Un changement de plan
  prend l'option de cette devise sur le nouveau prix, prorata compris, et un changement planifié
  (schedule) garde la devise dans ses phases.
- Un abonnement sur un ancien prix USD passe sur un prix multidevise qui a une option USD.
- Un coupon `percent_off` s'applique dans toutes les devises.

Frais : quand une boutique paie en GBP, Stripe convertit vers le compte en EUR au moment du
versement et prend une commission sur la part de Louez (de l'ordre de 2 % sur les grilles
européennes, à vérifier dans le Dashboard). Un compte de règlement en GBP l'évite.

## 4. Ce que fait le code maintenant

### 4.1 Règle

- Le catalogue (`lib/billing/plan-pricing.ts`) lit les quatre prix (`STRIPE_PRICE_{PRO,ULTRA}_{MONTHLY,YEARLY}`)
  avec leurs `currency_options`, une fois toutes les dix minutes par processus. Les plans se
  vendent dans **chaque devise où les quatre prix ont un montant fixe** (`buildPlanCatalog`).
- Les anciens prix USD (`STRIPE_PRICE_*_USD`) facturent toujours les abonnements USD en cours.
  Ils vendent encore en USD tant que les prix multidevises n'ont pas d'option USD ; ensuite, ils
  ne servent plus qu'à reconnaître ces abonnements (`findPlanPrice`).
- Une boutique achète dans sa devise si le catalogue la vend, en EUR sinon (`planCurrencyFor`).
  Le sélecteur EUR / USD disparaît : le serveur choisit, et `createCheckoutSession` ignore toute
  devise envoyée par le navigateur.
- Un abonnement en cours garde sa devise (`subscription.currency`) ; un changement de plan reste
  dans cette devise, et il est refusé si les plans ne s'y vendent plus.
- Une ligne sous le titre des plans l'explique quand la devise affichée n'est pas celle de la
  boutique : « Prix en EUR : les abonnements ne sont pas encore facturés en GBP. » ou
  « Votre abonnement est facturé en USD. »

### 4.2 Montants affichés

- Tous les montants viennent des prix Stripe, EUR compris. Si les prix live valent 49 € et 159 €,
  rien ne change à l'écran. Sur le compte de test, ils valent 29 € et 79 €, et c'est ce que la
  page de test affiche désormais.
- Si Stripe ne répond pas, la page vend en EUR aux montants du code (`fallbackPlanCatalog`).
- Un prix introuvable, archivé ou sur un autre intervalle bloque la vente et l'écrit dans les
  journaux (`the plans' Stripe prices sell nothing: …`).
- L'offre contextuelle compare ce que la boutique a payé avec le prix du plan **dans sa
  devise** ; si les plans ne s'y vendent pas, pas d'offre (exclusion `currency`).
- Les analytics d'abonnement donnent la devise de l'abonnement et le montant du plan dans cette
  devise, pas celui du prix par défaut.

### 4.3 Ajouter une devise

Dans Stripe, sur chacun des quatre prix : « Ajouter une devise », avec son montant. Rien d'autre.

### 4.4 Changer un montant plus tard

Une option ne se modifie pas : changer un prix demande quatre nouveaux prix Stripe (avec toutes
leurs devises), leurs identifiants dans les quatre variables, et un déploiement. Les anciens prix
continuent de facturer les abonnements en cours ; aujourd'hui, le code ne reconnaît comme
anciens prix que les prix USD (`legacyStripePrices`). Avant un tel changement, il faudra lui
apprendre la liste des anciens prix multidevises, sans quoi les webhooks ne retrouveraient plus
le plan de ces abonnements.

## 5. Décisions pour Téo

### 5.1 Devises au lancement

| Devise | Proposition                          | À trancher                                          |
| ------ | ------------------------------------ | --------------------------------------------------- |
| EUR    | Inchangé                             | —                                                   |
| USD    | Option USD sur les prix multidevises | $59 / $189 proposés (section 5.2)                   |
| GBP    | Candidate                            | Oui / non, selon le nombre de boutiques (section 2) |
| CHF    | Candidate                            | Oui / non, selon le nombre de boutiques             |
| CAD    | Candidate                            | Oui / non, selon le nombre de boutiques             |
| Autre  | Une option de plus dans Stripe (4.3) | D'après les comptages                               |

### 5.2 Grille de prix, HT

Taux de référence BCE du 18 novembre 2026 : 1 EUR = 1,0968 USD = 0,8329 GBP = 0,9243 CHF =
1,5690 CAD. Les colonnes « équivalent » sont la conversion brute ; Téo choisit le montant final.
L'annuel vaut dix mois : le badge « -17 % » de la page est écrit en dur, il faut garder ce
rapport.

| Plan        | EUR (actuel) | USD (actuel, 1:1) | Équivalent USD | Équivalent GBP | Équivalent CHF | Équivalent CAD |
| ----------- | ------------ | ----------------- | -------------- | -------------- | -------------- | -------------- |
| Pro mensuel | 49 €         | $49               | $53.74         | £40.81         | CHF 45.29      | CA$76.88       |
| Pro annuel  | 490 €        | $490              | $537.43        | £408.12        | CHF 452.91     | CA$768.81      |
| Ultra mens. | 159 €        | $159              | $174.39        | £132.43        | CHF 146.96     | CA$249.47      |
| Ultra ann.  | 1 590 €      | $1,590            | $1,743.91      | £1,324.31      | CHF 1,469.64   | CA$2,494.71    |

Proposition du 19 novembre 2026, à valider par Téo (prix « psychologiques », en 9) :

| Devise | Pro mensuel | Ultra mensuel | Pro annuel | Ultra annuel | Pro en € | Ultra en € |
| ------ | ----------- | ------------- | ---------- | ------------ | -------- | ---------- |
| EUR    | 49 €        | 159 €         | 490 €      | 1 590 €      | 49       | 159        |
| USD    | $59         | $189          | $590       | $1,890       | 53,8     | 172,3      |
| GBP    | £39         | £129          | £390       | £1,290       | 46,8     | 154,9      |
| CHF    | CHF 49      | CHF 159       | CHF 490    | CHF 1,590    | 53,0     | 172,0      |
| CAD    | CA$69       | CA$229        | CA$690     | CA$2,290     | 44,0     | 146,0      |

Autres décisions :

- **Site marketing** : il montre USD = EUR 1:1 hors Europe. Avec GBP, CHF ou CAD, faut-il y
  afficher les prix locaux ?
- **Codes promo** : BF2026-40 et les suivants doivent être des coupons `percent_off` sans
  restriction de devise, sinon ils ne valent qu'en EUR. À vérifier dans Stripe live.
- **Comptes de règlement** : en ouvrir dans les devises qui comptent, pour éviter la commission
  de conversion de Stripe.
- **Boutiques déjà abonnées en EUR ou USD hors de leur devise** : elles le restent. Les passer
  dans leur devise demande un nouvel abonnement ; rien n'est fait sans décision.

## 6. À faire dans Stripe live (après accord de Téo)

1. Vérifier que les quatre prix live valent 49 €, 490 €, 159 € et 1 590 € : la page affichera
   leurs montants.
2. Sur chacun des quatre prix, ajouter une option par devise retenue (USD compris), au montant
   décidé, avec le même comportement de taxe que le prix (la facturation active
   `automatic_tax`). Que ce soit dans le Dashboard ou par script, vérifier d'abord les montants : celui d'une devise ajoutée est définitif (4.4).
3. Vérifier les codes promo actifs (`percent_off`, pas de restriction de devise).
4. Ouvrir la page Abonnement d'une boutique de test dans chaque devise : les montants doivent
   être ceux des options. S'ils sont en EUR, les journaux disent quel prix pose problème.

Aucune variable à ajouter : les anciennes variables USD restent, pour les abonnements USD en
cours.

## Related

- [docs/domain/plan-offer.md](../domain/plan-offer.md) : l'offre contextuelle, qui compare dans la devise de la boutique.
- `louez-billing` `docs/api/README.md` §8.7 : ce que le service sait du plan d'une boutique.
