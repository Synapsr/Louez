# PRD — Referral Program

> Glossaire : voir `CONTEXT.md` (Referrer, Referred Store, Referral Reward, Referrer/Referred Reward, Qualifying Event, Free Reservation, Referral Guardrail).
> Décisions tracées : ADR 0002 (attribution par cookie partagé `.louez.io`), ADR 0003 (reward non-cash).

## Problem Statement

En tant que loueur satisfait de Louez, je n'ai aujourd'hui aucune raison concrète ni aucun moyen simple d'en faire profiter d'autres loueurs : je peux parler de l'outil, mais je n'y gagne rien. Et un nouveau loueur qui arrive sur recommandation d'un ami n'a aucun avantage à passer par lui plutôt qu'à s'inscrire seul. Le parrainage existant enregistre bien _qui a parrainé qui_, mais il ne récompense personne — il ne génère donc aucune croissance.

## Solution

Un **Referral Program double-face**. Un Referrer partage son lien ; quand le Referred Store réalise sa première vraie vente en ligne (≥ 20 €), **les deux côtés gagnent 30 réservations offertes** — le Referrer reçoit un crédit € équivalent s'il est abonné. Le Referred Store, lui, reçoit ses 30 réservations offertes dès l'inscription via le lien (au lieu des 15 de base). Le tout est visible depuis un hub de parrainage enrichi (et accessible aussi depuis les settings), avec des incitations contextuelles au bon moment et une notification quand un reward est débloqué.

Le reward reste une **valeur de compte non-cash** (réservations offertes / avoir sur facture), affichée comme _« X réservations offertes ≈ Y € économisés »_ — jamais un solde retirable.

## User Stories

1. En tant que Referrer, je veux un lien de parrainage personnel facile à copier, afin de le partager où je veux.
2. En tant que Referrer, je veux que mon lien pointe vers la vitrine (`louez.io/?ref=…`), afin que mon prospect atterrisse sur la meilleure page de présentation.
3. En tant que prospect, je veux que mon parrainage soit retenu même si je découvre Louez sur la vitrine avant d'aller sur l'app, afin que mon parrain soit bien crédité.
4. En tant que prospect, je veux que mon parrainage reste valable pendant 30 jours après le clic, afin de prendre le temps de me décider sans perdre l'avantage.
5. En tant que prospect arrivé via plusieurs liens, je veux que le dernier lien cliqué fasse foi (last-click), afin que l'attribution soit prévisible.
6. En tant que Referred Store, je veux recevoir 30 réservations offertes dès mon inscription via un lien de parrainage, afin de démarrer avec un avantage tangible.
7. En tant que Referred Store, je veux voir clairement que mes réservations offertes viennent de mon parrainage, afin de comprendre l'avantage reçu.
8. En tant que Referrer, je veux gagner 30 réservations offertes quand mon filleul fait sa première vente en ligne ≥ 20 €, afin d'être récompensé seulement quand j'ai amené un vrai loueur.
9. En tant que Referrer abonné (Pro/Ultra), je veux recevoir un crédit € équivalent plutôt que des réservations offertes (qui ne me serviraient pas), afin que ma récompense ait de la valeur.
10. En tant que Referrer, je veux être notifié (email + in-app) au moment où un filleul qualifie et débloque mon reward, afin de constater que le parrainage fonctionne vraiment.
11. En tant que Referrer, je veux un hub de parrainage qui montre mes filleuls et leur statut (inscrit / qualifié / reward versé), afin de suivre ma progression.
12. En tant que Referrer, je veux voir combien j'ai gagné, exprimé en réservations offertes **et** en valeur € (« ≈ Y € économisés »), afin de mesurer mon gain concret.
13. En tant que Referrer, je veux retrouver une entrée « Parrainage » dans les settings qui mène au hub, afin de le trouver là où je le cherche par réflexe.
14. En tant que Referrer, je veux que mes réservations offertes gagnées n'expirent pas, afin de les consommer à mon rythme.
15. En tant que loueur venant d'encaisser un paiement, je veux une incitation discrète à parrainer à ce moment-là, afin d'agir quand je suis le plus satisfait.
16. En tant que loueur, je ne veux pas être harcelé par des bandeaux ou des relances de parrainage permanents, afin de ne pas percevoir ça comme du spam.
17. En tant que Louez, je veux bloquer l'auto-parrainage (un Store ne peut pas être son propre parrain), afin d'éviter la fraude évidente.
18. En tant que Louez, je veux révoquer (clawback) un Referrer Reward si le paiement qualifiant est remboursé ou disputé dans une fenêtre donnée, afin de ne pas payer sur une vente annulée.
19. En tant que Louez, je veux que le clawback ne retire que les réservations offertes **non encore consommées**, afin de rester juste et applicable.
20. En tant que Louez, je veux un montant minimum de paiement qualifiant réglable (20 € au lancement), afin d'ajuster le seuil anti-abus sans redéploiement.
21. En tant que Louez, je veux un plafond de filleuls récompensés par mois et par Referrer, désactivé au lancement mais prêt à activer, afin de couper le farming si j'en constate.
22. En tant que Louez, je veux que seuls les paiements **en ligne (Stripe)** qualifient, pas les saisies manuelles, afin que la preuve d'activité ne soit pas falsifiable.
23. En tant qu'admin Louez, je veux configurer les paramètres du programme (nombre de réservations offertes de chaque côté, montant minimum, plafond, fenêtre de clawback), afin de piloter l'économie du programme.
24. En tant que Referrer, je veux que le programme reste accessible quelle que soit la page du site sur laquelle mon prospect arrive, afin de ne pas perdre d'attribution.
25. En tant que Louez, je veux ne montrer au Referrer que le nom du Store filleul et son statut (pas son chiffre d'affaires ni son activité détaillée), afin de respecter la vie privée du filleul.
26. En tant que loueur, je veux pouvoir lire les conditions du programme de parrainage, afin de connaître les règles (éligibilité, déblocage, droit de modification/arrêt).
27. En tant que Referrer, je veux comprendre que le reward est un avoir / des réservations offertes et non un virement, afin de ne pas avoir de fausse attente de cash.
28. En tant que Louez, je veux pouvoir modifier ou arrêter le programme à tout moment selon les conditions, afin de garder la main.

## Implementation Decisions

**Réutilisation de l'existant**

- Les codes de parrainage (`referralCode`, format `LOUEZ…`), la résolution `referredByUserId` / `referredByStoreId` à l'onboarding, et le hub `/dashboard/referrals` + ses stats existent déjà.
- La mécanique « réservation offerte » existe : allocation `freeReservationsGranted` snapshotée par Store, consommation dérivée du ledger `platformFees` avec `source='free'`. Le Referred Reward et le Referrer Reward (PAYG) réutilisent cette mécanique.
- Le clawback s'appuie sur les webhooks Stripe Connect refund/dispute déjà en place.

**Reward**

- Nouveau registre de **Referral Reward** : un enregistrement par filleul qualifié, reliant le Referrer, le Referred Store et le paiement qualifiant, avec un statut (`pending` → `granted` → `clawed_back`). One-time par filleul.
- **Plan-aware** : si le Referrer est pay-as-you-go → incrément de son allocation de réservations offertes ; s'il est abonné → crédit € sur sa facture Louez (avoir / customer balance Stripe).
- **Referred Reward** : à l'onboarding via lien, l'allocation de réservations offertes du nouveau Store est portée à 30 (au lieu de 15).
- **Affichage** : tout gain de Referrer est présenté comme « N réservations offertes ≈ Y € économisés » (Y = N × tarif PAYG applicable, ou directement le crédit € pour un abonné). Jamais un solde retirable (ADR 0003).

**Qualifying Event**

- Détecté dans le flux de paiement **en ligne** du Referred Store (webhook Stripe Connect d'encaissement) : premier paiement de réservation en ligne ≥ montant minimum réglable. Une saisie manuelle ne qualifie pas. Le déblocage du Referrer Reward part de là.

**Attribution** (ADR 0002)

- Cookie `louez_referral` scopé `domain=.louez.io`, `max-age` 30 jours, `SameSite=Lax`, **last-click**.
- Posé par un **middleware** sur la vitrine (`Louez-Website`, en étendant le middleware i18n existant — le `Set-Cookie` doit être attaché aussi aux réponses de redirection de locale) **et** par un **middleware** côté app. Le capteur JS login-only actuel est supprimé.
- Le lien partagé généré pointe vers `louez.io/?ref=<code>`.
- L'attribution se fige à la **fin de l'onboarding** (création du Store), pas au clic.

**Anti-fraude (Referral Guardrails)**

- Self-referral bloqué (le `userId` du Referred Store doit différer de celui du Referrer) — toujours actif.
- Clawback sur refund/dispute du paiement qualifiant dans une fenêtre réglable (30 j au lancement) — toujours actif.
- Montant minimum (20 €) actif et réglable ; plafond mensuel par Referrer construit mais permissif (illimité) au lancement.

**Surfaçage (niveau B)**

- Hub `/dashboard/referrals` enrichi (lien, filleuls + statut, gains en réservations/€) + entrée « Parrainage » dans les settings menant au hub.
- Incitations contextuelles aux pics de satisfaction (après un paiement encaissé), discrètes.
- Notification de reward au Referrer : email + in-app.

**Admin / configuration**

- Les paramètres du programme (réservations offertes de chaque côté, montant minimum, plafond mensuel, fenêtre de clawback) sont configurables, dans la même philosophie que la config PAYG existante (valeurs par défaut + override).

**Légal**

- Section « Conditions du parrainage » dans les pages légales (`(legal)/terms`) : éligibilité, reward non-cash/non-transférable/non-convertible, condition de déblocage, anti-abus + clawback, droit de modifier/arrêter. Rédaction à valider par un avocat.
- Cadrage comptable : remise commerciale / avoir, jamais un revenu versé. À valider par un comptable.

## Testing Decisions

- **Pattern du repo** : tests unitaires de **fonctions pures** via `node:test` (`node:assert/strict`), sans DB ni HTTP ni mocks. Un bon test vérifie le **comportement externe** d'une fonction pure, pas son implémentation.
- **Prior art** : `apps/web/lib/pay-as-you-go/config.test.ts` (teste `graduatedTotalCents`, `priceForLocationIndex`, …). Les nouveaux tests le miment.
- **Fonctions pures à extraire et tester** :
  1. **Qualification** — (paiement : montant, canal en-ligne/manuel ; config min) → qualifie ou non.
  2. **Calcul du reward plan-aware** — (mode de facturation du Referrer, taille du reward) → grant (N réservations offertes _ou_ crédit €) + valeur d'affichage « N ≈ Y € ».
  3. **Résolution d'attribution** — (code ref, Store referrer, userId courant) → `referredBy…` ou `null` (self-referral, code invalide, Store inconnu). Logique extraite du flux d'onboarding.
  4. **Clawback** — (reward accordé, refund/dispute dans la fenêtre, réservations déjà consommées) → quantité à révoquer.
  5. **Plafond mensuel** — (nb de filleuls récompensés ce mois, cap) → autorisé / refusé.
- **Hors test unitaire dédié** (cohérent avec un repo sans test de middleware/webhook) : les deux middlewares cookie, le câblage webhook du Qualifying Event, l'envoi de notification — glue mince autour des fonctions pures ci-dessus.

## Out of Scope

- **Affiliate Program externe** (promoteurs non-clients), **payouts cash**, et **commission récurrente** : explicitement reportés (ADR 0003). Le récurrent et le cash appartiennent à la phase « promoteurs externes ».
- **Invitation par email** d'un tiers (le programme reste en partage de lien uniquement, pour éviter tout enjeu de consentement/anti-spam).
- **Match d'empreinte carte/IBAN** entre Referrer et filleul : barrière anti-fraude v2.
- **Attribution sur storefront en domaine custom** (feature Ultra) : impossible par construction (hors `.louez.io`).
- **Tiering / paliers de récompense** pour gros parrains : non au lancement.

## Further Notes

- L'économie tient : un filleul qualifié « coûte » au pire ~45 € de frais effacés (et seulement s'ils sont consommés sur du vrai business), pour acquérir un Store qui paie ensuite ~1 €/réservation — payback < 1 mois dès ~50 locations/mois côté filleul.
- Posture de lancement assumée : construire les knobs anti-abus, lancer permissif (plafond off), durcir seulement si on observe de l'abus.
- RGPD : minimiser ce que le Referrer voit du filleul (nom + statut, pas le CA).
- Le second repo (`Louez-Website`) est impacté pour le seul middleware d'attribution — à coordonner avec ce repo.
