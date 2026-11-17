# Offre d'abonnement contextuelle

Une boutique au paiement à l'usage voit, sur l'accueil du tableau de bord, une carte qui lui
propose Pro ou Ultra quand l'abonnement lui aurait coûté moins cher que ce qu'elle a payé à
Louez dans le mois. Les chiffres sont ceux de la boutique, à son tarif réel. Rien n'est
proposé sur une instance auto-hébergée (`LOUEZ_BILLING` autre que `cloud`).

Le code :

- la règle, pure : `apps/web/lib/billing/plan-offer-core.ts` ;
- les faits (montants, limites, exclusions) et le passage à Stripe :
  `apps/web/lib/billing/plan-offer.ts` ;
- l'e-mail : `apps/web/lib/billing/plan-offer-email.ts` (choix des boutiques) et
  `plan-offer-effects.ts` (envoi) ;
- les procédures : `billing.getPlanOffer`, `billing.recordPlanOfferShown`,
  `billing.dismissPlanOffer` et `billing.startPlanOffer`
  (`packages/api/src/routers/dashboard/billing.ts`).

Les quatre procédures sont réservées au tableau de bord (session) et au propriétaire de la
boutique, comme les pages de facturation. Elles ne sont exposées ni à l'API ni au MCP.

## Ce que la boutique a payé

Le montant dépend de qui facture la boutique ce mois-là.

**Boutique facturée par Louez (créée avant la bascule).** On additionne les frais par
réservation enregistrés pour le mois (`platform_fee`, sources `online` et `manual`, statuts
actifs) :

- chaque frais est pris net de ce qu'un remboursement a rendu ;
- chaque frais est plafonné au prix que le tarif d'aujourd'hui demanderait pour la même place
  dans le mois. Une offre de lancement baissée depuis, ou devenue gratuite, compte donc à son
  prix actuel ;
- les réservations gratuites ne coûtent rien ;
- la commission de la marketplace reeent est exclue : un abonnement la paie aussi.

**Boutique facturée par le service louez-billing.** On lit son relevé du mois et on garde les
lignes qu'un abonnement aurait évitées, c'est-à-dire les groupes `commission`, `unpaid`
(commission sur un reste non payé) et `reservations` (frais par réservation) :

- les frais de la marketplace sont exclus ;
- les lignes qui régularisent un mois précédent (`adjustsPeriod`) sont exclues ;
- si le service ne répond pas, aucune offre n'est faite.

Deux mois sont comparés : le mois en cours (UTC, depuis le 1er) et le mois précédent. Le mois
précédent ne compte que s'il a été facturé de la même façon qu'aujourd'hui. Le texte de la carte
dit « Ce mois-ci » ou « Le mois dernier ».

## La règle

On cherche d'abord, pour chaque mois comparé, le plan le moins cher qui convient à la boutique :

- elle tient dans les limites de Pro (produits, clients, collaborateurs aujourd'hui, et
  réservations du mois comparé comme du mois en cours) : Pro ;
- sinon : Ultra.

L'abonnement coûte son prix mensuel HT plus la TVA du pays de la boutique. La commission, elle,
s'entend TTC, comme le dit la page tarifs. On compare donc le montant payé au prix du plan avec
cette TVA :

```
seuil    = prix mensuel HT du plan × (1 + taux normal de TVA du pays de la boutique)
offre si   montant payé > seuil
économie = montant payé − seuil
```

Le taux est celui du pays de la boutique dans l'UE (tableau `EU_STANDARD_VAT_BPS`), 0 hors de
l'UE. Une boutique sans pays compte comme française. Pro en France : 49 € × 1,20 = 58,80 €.

## Exclusions

Aucune offre ne s'affiche dans les cas suivants :

- un plan est en vigueur, essai et impayé compris ;
- la plateforme a mis la boutique en mode abonnement ;
- la boutique a un coupon ou une remise admin ;
- la carte a été fermée il y a moins de 30 jours ;
- le tarif d'aujourd'hui est gratuit ;
- la devise de la boutique n'a pas de prix Stripe pour le plan.

## Le bouton

« Passer à Pro » (ou Ultra) ouvre le Stripe Checkout de l'abonnement mensuel, avec les mêmes
URL de retour que la page Abonnement. Il n'y a pas d'essai : la boutique connaît déjà Louez, et
l'abonnement est sans engagement.

Comme une boutique avec coupon ne voit pas l'offre, le Checkout garde son champ de code promo
(`allow_promotion_codes`). L'offre est recalculée côté serveur au clic. Une boutique qui a pris
un plan entre-temps, ou qui a reçu une remise, n'ouvre rien.

## L'e-mail

Le propriétaire reçoit un seul e-mail, la première fois que la règle propose un plan, même si la
carte a été fermée :

- le cron le prépare chaque jour à 08 h 15 UTC ;
- la boutique est marquée (`stores.plan_offer_notified_at`) et l'e-mail est mis dans la file de
  sortie dans la même transaction ;
- l'envoi revérifie qu'aucun plan, coupon ou remise n'est arrivé depuis.

## Événements PostHog

Les trois événements sont envoyés côté serveur. Ils portent `store_id`, `plan`,
`billing_source`, `period`, `month`, `currency`, `paid_cents`, `plan_price_cents`,
`threshold_cents`, `savings_cents` et `vat_rate_bps`.

| Événement | Quand |
| --- | --- |
| `plan_offer_shown` | La carte est à moitié visible à l'écran, une fois par visite de l'accueil. |
| `plan_offer_dismissed` | Le propriétaire ferme la carte. Passe par la file de sortie, dans la transaction de la fermeture. |
| `plan_offer_clicked` | Le Checkout est ouvert. Passe par la file de sortie. |

Le début de l'abonnement (`subscription_started`) est un événement du cycle de vie de la
boutique : il n'est pas émis ici.

## Limites connues

- Deux clics simultanés peuvent ouvrir deux Checkout. C'est déjà le cas sur la page
  Abonnement : `createSubscriptionCheckoutSession` expire les sessions ouvertes, mais ne
  sérialise pas leur création.
- L'e-mail part au moins une fois : un crash entre l'acceptation SMTP et l'enregistrement de
  l'envoi le fait repartir (voir la file de sortie, `docs/architecture/api-and-agents.md`).
- Le tableau des taux de TVA est tenu à la main.
