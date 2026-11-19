# Accueil du dashboard — une prochaine étape à la fois

Statut : en place (novembre 2026). Propriétaire : Téo.

## Problème

En haut de l'accueil, une boutique neuve voyait jusqu'à cinq invitations empilées : connecter un
assistant IA, la réservation test, « Trouvez vos premiers clients », l'offre de lancement
reeent, et la checklist flottante « Mise en route ». Chacune avait sa propre condition, aucune
ne tenait compte des autres : l'écran disait tout à la fois et rien en premier.

## Règle

1. **Une seule carte de prochaine étape**, choisie d'après l'état réel de la boutique
   (`homeNextSteps`, `apps/web/components/dashboard/home/util.next-step.ts`). La première
   candidate de la liste ci-dessous gagne.
2. **La checklist « Mise en route » porte le reste** tant qu'elle est affichée (boutique sans
   client) : chaque étape y garde son action, la recherche de clients et l'assistant IA compris.
3. **Une offre n'a plus de bandeau à elle** : elle rejoint l'étape où elle sert. L'offre de
   lancement reeent est une ligne de la carte « Trouvez vos premiers clients » ; l'assistant IA
   est l'option secondaire de « Ajoutez votre premier produit » et une ligne de la checklist.
4. **Seulement une action que le loueur peut encore faire** : une carte qui ne propose rien à
   faire (un badge obtenu, une information) n'a pas sa place dans l'emplacement. Une boutique
   établie et déjà configurée le voit donc vide.
5. **Le travail du jour n'est pas du guidage** : l'alerte des demandes en attente, la bannière
   de pause des réservations (facturation) et l'activité du jour restent affichées comme avant,
   au-dessus et en dessous de la carte.

Chaque fermeture reste valable (`users.dismissed_notices`, et le report de 30 jours
de l'offre de plan sur la boutique). Fermer une carte fait passer à la suivante à la visite
suivante de l'accueil.

## Candidates, dans l'ordre

| #   | Carte                                 | Quand                                                                                                                                                                                    |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Activer les paiements pour reeent     | Boutique venue de reeent, en mode paiement, Stripe pas encore actif (reeent ne la publie pas avant)                                                                                      |
| 2   | Ajoutez votre premier produit         | Aucun produit actif, boutique pas encore établie. Option secondaire : laisser un assistant IA s'en charger, tant qu'il est proposé                                                       |
| 3   | Réservation test (« Première étape ») | Un produit actif, aucune vraie réservation, le test pas terminé ni annulé, la carte pas fermée                                                                                           |
| 4   | Offre de plan                         | Propriétaire, instance qui facture, une vraie réservation, et une offre calculée par la facturation ; sinon la candidate suivante prend la place                                         |
| 5   | Trouvez vos premiers clients          | Boutique en ligne avec un produit actif, pas encore établie, une étape du guide encore à faire, la carte pas fermée. Ligne « Offre de lancement » si la boutique y a droit               |
| 6   | Assistant IA                          | Pas encore fermé, aucun agent connecté, boutique pas encore établie                                                                                                                      |
| 7   | Offre de lancement reeent (places)    | Instance qui facture, boutique pas venue de reeent, jamais publiée sur reeent, pas encore membre de la cohorte, places encore ouvertes ; pas fermé. Lien vers Réglages → Canaux de vente |

L'offre de plan passe avant le guide de visibilité : elle n'existe que pour une boutique qui a
déjà payé des commissions, donc plus au stade des premiers clients. Elle est lue en streaming,
comme avant : la carte apparaît dès que la facturation répond, sans retenir le reste de
l'accueil.

## Boutique établie

Une boutique est **établie** dès qu'un vrai client a loué chez elle : une vraie réservation
(pas la réservation test) qu'elle a acceptée — confirmée, en cours ou terminée — ou un paiement
de location reçu (`isEstablishedStore`, lu sur les compteurs de l'accueil, qui écartent déjà
les tests).

Une boutique établie ne voit plus aucune carte de démarrage : ni « Ajoutez votre premier
produit », ni la réservation test, ni « Trouvez vos premiers clients », ni l'assistant IA (sa
carte propose de « configurer votre boutique »). Ces cartes parlent d'un stade qu'elle a passé ;
une boutique qui encaisse les voyait comme une erreur. « Se faire connaître » reste dans la
barre latérale pour toutes les boutiques, et connecter un assistant IA dans Réglages →
Intégrations → MCP : seule la relance de l'accueil disparaît. Restent les cartes qui servent
une activité en cours : l'activation des paiements pour reeent, l'offre de plan et
l'invitation à prendre une place de lancement reeent, chacune selon sa propre condition. Sans
aucune d'elles, l'accueil n'a pas de carte.

## Offre de lancement reeent

L'exonération de commission reeent à vie est accordée à la première publication d'une boutique
sur reeent, tant qu'il reste des places dans la cohorte de lancement. L'accueil n'en parle que
comme d'une invitation : à une boutique qui peut encore la gagner, c'est-à-dire pas venue de
reeent (elle y est déjà inscrite, sa carte Stripe porte l'offre), jamais publiée sur reeent, sans
exonération, et tant qu'il reste des places (`canClaimLaunchSeat`). La ligne mène à Réglages →
Canaux de vente, où se fait la publication, et se ferme (`reeent-cohort-seats`).

Une boutique déjà membre de la cohorte ne voit rien à ce sujet sur l'accueil : son badge
« Offre reeent à vie — Membre n°… » reste sur Réglages → Canaux de vente, sans fermeture,
comme la place où l'offre se retrouve toujours. L'ancien identifiant de fermeture du badge
(`reeent-cohort-member`) est retiré ; une valeur restée en base se lit comme non fermée.

Pourquoi ce critère :

- **Une demande en attente, refusée ou annulée ne compte pas** : n'importe qui peut envoyer une
  demande, et la boutique qui n'en a accepté aucune cherche encore ses premiers clients. La
  carte de visibilité lui reste utile.
- **Un paiement reçu compte** : c'est la preuve la plus nette d'un client réel, même si la
  réservation a été annulée ensuite.
- **Pas de nouvelle requête** : les compteurs de l'accueil (`getStoreMetrics`) donnent déjà les
  réservations confirmées, en cours et terminées et les encaissements, hors tests.
- Une réservation saisie à la main par le loueur compte : on ne sait pas la distinguer d'un
  client au téléphone, et la réservation test existe pour s'essayer.

## Les étapes de la boutique

| Étape                                      | Carte principale                                                                                        | Dans la checklist ou ailleurs                                                                                                            | Masqué                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Boutique reeent sans Stripe                | Activer les paiements pour reeent                                                                       | Étape « Activez les paiements en ligne » en tête                                                                                         | Tout le reste du guidage                        |
| Aucun produit                              | Ajoutez votre premier produit (+ IA)                                                                    | Étape « Ajouter votre premier produit », ligne assistant IA                                                                              | Offre reeent, visibilité (pas de produit)       |
| Produit, pas encore en ligne               | —                                                                                                       | Ne se présente pas : le dashboard renvoie à l'onboarding tant que la boutique n'est pas en ligne                                         | —                                               |
| En ligne, aucune réservation, test à faire | Réservation test                                                                                        | « Recevoir votre première réservation » : réservation test, « Trouvez vos premiers clients », voir la boutique                           | Visibilité, assistant IA, offre reeent          |
| Test terminé ou fermé, pas de vrai client  | Trouvez vos premiers clients                                                                            | Même étape de la checklist ; assistant IA en ligne de la checklist                                                                       | Assistant IA, offre reeent seule                |
| Demande reçue, pas encore acceptée         | Offre de plan, sinon visibilité                                                                         | La checklist disparaît au premier client, comme avant                                                                                    | Ce qui suit dans la liste                       |
| Établie (réservation acceptée ou payée)    | Offre de plan, sinon invitation à une place de lancement reeent (jamais publiée sur reeent), sinon rien | « Se faire connaître » dans la barre latérale ; assistant IA : Réglages → Intégrations → MCP ; offre reeent : Réglages → Canaux de vente | Premier produit, test, visibilité, assistant IA |
| Établie et membre de la cohorte reeent     | Offre de plan, sinon rien                                                                               | Badge de membre : Réglages → Canaux de vente                                                                                             | Tout le reste, badge reeent compris             |
| Paiements (boutique hors reeent)           | —                                                                                                       | Étape « Activez les paiements en ligne » de la checklist, tant qu'elle est affichée                                                      | —                                               |

**Paiements hors reeent** : pas de carte. Sans Stripe, la boutique prend des demandes au lieu
de paiements et fonctionne ; une carte sans fermeture deviendrait une relance permanente, une
carte fermable un réglage de plus. À trancher si les données montrent que des boutiques restent
en mode demande sans le vouloir.

## Réservation test

La carte se ferme désormais (`test-reservation` dans `users.dismissed_notices`) : sans cela, un
loueur qui ne veut pas de test ne voyait jamais la suite. Supprimer les données de test depuis
le dashboard la ferme aussi, sinon la carte revenait proposer un nouveau test une fois le
premier effacé. La réservation test reste accessible depuis l'étape « Recevoir votre première
réservation » de la checklist.

## Mesure

`home_next_step_viewed` (`step` : la carte montrée), une fois par affichage de l'accueil
([docs/analytics/home.md](../analytics/home.md)). Les événements de chaque carte restent les
mêmes (`visibility_viewed` avec `placement: home_card`, `plan_offer_shown`…), mais ils ne
partent que quand leur carte est la prochaine étape.

## Related

- [visibilite-boutiques.md](visibilite-boutiques.md) — le guide « Se faire connaître »
- [docs/analytics/home.md](../analytics/home.md)
- [docs/analytics/test-reservation.md](../analytics/test-reservation.md)
- [docs/domain/plan-offer.md](../domain/plan-offer.md)
