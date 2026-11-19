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
4. **Le travail du jour n'est pas du guidage** : l'alerte des demandes en attente, la bannière
   de pause des réservations (facturation) et l'activité du jour restent affichées comme avant,
   au-dessus et en dessous de la carte.

Chaque fermeture existante reste valable (`users.dismissed_notices`, et le report de 30 jours
de l'offre de plan sur la boutique). Fermer une carte fait passer à la suivante à la visite
suivante de l'accueil.

## Candidates, dans l'ordre

| #   | Carte                                    | Quand                                                                                                                                                  |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Activer les paiements pour reeent        | Boutique venue de reeent, en mode paiement, Stripe pas encore actif (reeent ne la publie pas avant)                                                    |
| 2   | Ajoutez votre premier produit            | Aucun produit actif. Option secondaire : laisser un assistant IA s'en charger, tant qu'il est proposé                                                  |
| 3   | Réservation test (« Première étape »)    | Un produit actif, aucune vraie réservation, le test pas terminé ni annulé, la carte pas fermée                                                         |
| 4   | Offre de plan                            | Propriétaire, instance qui facture, une vraie réservation, et une offre calculée par la facturation ; sinon la candidate suivante prend la place       |
| 5   | Trouvez vos premiers clients             | Boutique en ligne avec un produit actif, une étape du guide encore à faire, la carte pas fermée. Ligne « Offre de lancement » si la boutique y a droit |
| 6   | Assistant IA                             | Pas encore fermé, aucun agent connecté                                                                                                                 |
| 7   | Offre reeent (badge de membre ou places) | Badge gagné, ou places encore ouvertes pour une boutique qui n'est pas venue de reeent ; pas fermé                                                     |

L'offre de plan passe avant le guide de visibilité : elle n'existe que pour une boutique qui a
déjà payé des commissions, donc plus au stade des premiers clients. Elle est lue en streaming,
comme avant : la carte apparaît dès que la facturation répond, sans retenir le reste de
l'accueil.

## Les étapes de la boutique

| Étape                                      | Carte principale                     | Dans la checklist ou ailleurs                                                                                  | Masqué                                    |
| ------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Boutique reeent sans Stripe                | Activer les paiements pour reeent    | Étape « Activez les paiements en ligne » en tête                                                               | Tout le reste du guidage                  |
| Aucun produit                              | Ajoutez votre premier produit (+ IA) | Étape « Ajouter votre premier produit », ligne assistant IA                                                    | Offre reeent, visibilité (pas de produit) |
| Produit, pas encore en ligne               | —                                    | Ne se présente pas : le dashboard renvoie à l'onboarding tant que la boutique n'est pas en ligne               | —                                         |
| En ligne, aucune réservation, test à faire | Réservation test                     | « Recevoir votre première réservation » : réservation test, « Trouvez vos premiers clients », voir la boutique | Visibilité, assistant IA, offre reeent    |
| Test terminé ou fermé, pas de vrai client  | Trouvez vos premiers clients         | Même étape de la checklist ; assistant IA en ligne de la checklist                                             | Assistant IA, offre reeent seule          |
| Premières vraies réservations              | Offre de plan, sinon visibilité      | La checklist disparaît au premier client, comme avant                                                          | Ce qui suit dans la liste                 |
| Paiements (boutique hors reeent)           | —                                    | Étape « Activez les paiements en ligne » de la checklist, tant qu'elle est affichée                            | —                                         |
| Croissance                                 | Offre de plan, sinon la suivante     | Assistant IA : Réglages → Intégrations → MCP ; offre reeent : Réglages → Canaux de vente                       | Ce qui suit dans la liste                 |

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
