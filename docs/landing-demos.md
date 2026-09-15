# Démonstrations de la landing

La variante C du site marketing charge les démonstrations depuis l’application Louez, dans des iframes. Les écrans de démonstration et le produit importent les mêmes composants. Une mise à jour déployée de ces composants apparaît donc dans la landing au prochain chargement de la démo.

## Source partagée

| Scène       | Composants utilisés dans Louez et dans la démo                                   |
| ----------- | -------------------------------------------------------------------------------- |
| Boutique    | `ProductCard`, `RentalPeriodPicker`, `QuickAddDialogView`, `QuickAddVariantView` |
| Gestion     | `DashboardStatCard`, `ActivityCardView`, `ActivityListItem`                      |
| Réservation | `ReservationIdentity`, `ReservationItemsCard`, `ActivityTimelineV2`              |
| Conseiller  | `AdvisorPanel`, ses messages et son champ de saisie                              |

Les vues extraites conservent leur rendu. Le produit garde ses requêtes, ses règles de disponibilité, ses mutations et ses contrôles d’accès dans les composants qui les appellent. Les scènes de démonstration fournissent des fixtures et des callbacks locaux. Elles ne testent pas un paiement, un contrat ou une réservation réelle.

Le site marketing conserve uniquement le cadre, les contrôles et le lecteur `postMessage`. Il ne copie ni les styles ni le JSX de l’application. Les cadrages des scènes et le scénario restent propres à la landing : un changement important de navigation produit peut demander de revoir ces scénarios.

## Routes et intégration

- `/demos/landing/rental` : parcours en trois étapes.
- `/demos/landing/storefront?compact=1`, `/planning?compact=1`, `/reservation?compact=1` sous le même préfixe : petites démonstrations.
- `/demos/landing/advisor` : conversation avec des réponses de démonstration.

Le marketing utilise `NEXT_PUBLIC_LOUEZ_DEMO_URL`, avec `https://app.louez.io` par défaut en production. Cette variable est résolue au build du marketing et doit aussi être autorisée par son `frame-src`. Le build de l’app qui contient les routes doit être déployé avant la landing qui les intègre.

En local, l’origine est `https://landing-demos.louez.localify`. Le serveur de démo appartient au worktree `louez-landing-demos`, branche `feat/synchronized-landing-demos`. Depuis `apps/web`, avec une configuration locale sans données réelles :

```sh
localify dev web --project louez --env landing-demos -- pnpm exec next dev --hostname 127.0.0.1
```

## Lecture et prise en main

Chaque scène dure au maximum 4,6 secondes. Le curseur animé actionne les vrais contrôles. La lecture s’arrête au survol, pendant l’usage du clavier, hors écran et dans un onglet masqué. Elle reprend à la sortie du curseur. Un contact tactile met la lecture en pause ; le bouton Lecture permet de la relancer. La préférence système de réduction des animations désactive la lecture automatique.

La quantité, les dates et les options choisies suivent le parcours jusqu’au dossier de réservation. Chaque petite scène peut aussi être manipulée séparément. Aucun état n’est sauvegardé.

## Limites de la route publique

Le proxy traite ces routes avant la résolution d’une boutique et n’autorise que GET et HEAD. Le marqueur interne de rendu ne peut pas être fourni par une requête externe. Le layout de démonstration n’installe pas les providers métier ni les traceurs de l’app. Les origines de la landing sont explicitement autorisées pour l’intégration ; la protection des pages de compte et de gestion reste inchangée.

La CSP des démonstrations autorise les requêtes de rendu Next.js sous `/demos/landing/`, et les ressources de développement lorsque nécessaire. Elle n’autorise pas les appels aux API métier. Le dialogue et le conseiller désactivent leur prise de focus automatique et leur modalité dans les démos pour permettre au visiteur de sortir du cadre.

## Validation locale du 15 septembre 2026

- Builds complets de Louez et du marketing réussis.
- TypeScript et lint ciblé réussis.
- Tests du périmètre public, des en-têtes, du lecteur et du rendu des montants de réservation.
- Parcours de réservation essayé au clavier dans la landing : deux vélos, taille M, dossier à 40 € et caution à 300 €.
- Survol et sortie vérifiés dans le navigateur : pause puis reprise.

Ces vérifications concernent le code et les serveurs locaux. Aucun déploiement n’a été effectué.
