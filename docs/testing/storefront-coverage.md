# Périmètre de recette du storefront

Inventaire établi à partir du schéma, des réglages de boutique, des routes publiques et des services utilisés par ce checkout. La matrice exécutable se trouve dans `apps/web/scripts/storefront-qa/scenarios.ts` ; l’index généré associe chaque cas à une URL et à sa source dans le code.

## Fonctions et dépendances

| Domaine      | États identifiés                                                                                                                                                                               | Sources principales                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Présentation | Boutique vide ou minimale, catégories, produits, thème clair/sombre, photos du hero, variantes de présentation, contact, pages légales, embed                                                  | `components/storefront/home`, `components/storefront/shell`, `packages/types/src/store.ts`                                         |
| Catalogue    | Recherche, filtres combinés, dates, navigation par catégories, aucun résultat, conservation des paramètres                                                                                     | `lib/storefront/catalog.queries.ts`, routes `catalog` et `rental`                                                                  |
| Produit      | Actif/brouillon/archivé, stock nul/limité, unités et variantes, unité retirée, accessoires obligatoires/facultatifs                                                                            | `packages/db/src/schema.ts`, `components/storefront/product`, `lib/utils/util.variant-combinations.ts`                             |
| Prix         | Heure/jour/semaine, forfait, paliers stricts, saison, taxes HT/TTC, taux produit, devise, caution, remise                                                                                      | `packages/api/src/services/pricing-catalog.ts`, `lib/reservations/price-cart.ts`                                                   |
| Stock        | Matériel retournable, consommable, stock non suivi, demandes en attente bloquantes ou non, remise en stock différée, concurrence                                                               | `packages/db/src/unit-availability.ts`, `packages/api/src/services/availability.ts`, `lib/reservations/reserve-inventory.ts`       |
| Période      | Préavis, durées minimale/maximale, horaires fractionnés, dimanche fermé, fermeture datée, fuseau et changement d’heure                                                                         | `packages/types/src/store.ts`, `lib/reservations/validate-rental-window.ts`                                                        |
| Panier       | Vide, ajout simple, variante requise, quantité, retrait/restauration, période, persistance, isolation entre boutiques                                                                          | `components/storefront/cart`, `lib/utils/util.cart-lines.ts`, `lib/utils/util.cart-storage.ts`                                     |
| Checkout     | Particulier/professionnel, validation, adresse demandée, promo, consentement, envoi en cours, erreur et double clic                                                                            | `app/(storefront)/[slug]/checkout`, `lib/reservations/create-reservation.ts`                                                       |
| Réservation  | Demande, paiement, Stripe incomplet et repli en demande, confirmation et annulation                                                                                                            | `lib/reservation-mode.ts`, `lib/reservations/start-checkout-payment.ts`                                                            |
| Paiement     | Intégral/acompte, reste dû, session ouverte/payée, retour non payé, succès répété, erreur de fournisseur                                                                                       | `lib/reservations/complete-checkout-payment.ts`, `lib/stripe/payment-completion.ts`                                                |
| Livraison    | Désactivée/facultative/obligatoire/incluse, aller/retour indépendants, lieux multiples, rayon, frais minimum, minimum de commande, gratuité                                                    | `lib/reservations/resolve-delivery.ts`, `packages/api/src/services/address.ts`, `distance.ts`                                      |
| Assurance    | Désactivée/facultative/obligatoire/masquée, aucun/tous/certains produits couverts, acceptation/refus, devis lent ou en erreur, contrat                                                         | `lib/integrations/tulip/settings.ts`, `contracts.ts`, `checkout/hooks/use-checkout-tulip-quote.ts`                                 |
| Compte       | Code email, session, déconnexion, profil, accès direct, jeton expiré, isolation entre clients et boutiques                                                                                     | `lib/customer-auth`, routes `account` et `r/[reservationId]`                                                                       |
| Suivi        | pending, confirmed, ongoing, completed, cancelled, rejected, quote, declined ; timeline, historique daté, devis, contrat, états des lieux PDF, calendrier, changement de dates et prolongation | `packages/db/src/schema.ts`, `lib/reservations/util.reservation-actions.ts`, `util.reservation-updates.ts`, `extension-service.ts` |
| Caution      | none, pending, card_saved, authorized (active ou expirée), captured (montant et motif), released, failed ; caution manuelle reçue ou restituée ; autorisation en ligne depuis le compte        | `packages/db/src/schema.ts`, `lib/reservations/util.customer-deposit.ts`, route `authorize-deposit`                                |
| Transversal  | Mobile/desktop, clavier, chargement, erreurs réseau, retour arrière, rechargement, langues et formats                                                                                          | Ensemble des routes et composants concernés                                                                                        |

## Couverture à interpréter

Une boutique préparée rend un état reproductible ; elle ne prouve pas que le comportement est correct. La présence d’un lien ne prouve pas que le scénario a été exécuté. Les résultats manuels et les vérifications effectuées par l’agent doivent rester distincts.

La matrice couvre des parcours représentatifs et les interactions à risque. Elle n’énumère pas le produit cartésien de toutes les options. Pour un déploiement, compléter les contrôles selon le diff final : mises en concurrence de stock et paiement, changement d’heure, expiration et appartenance des jetons, restrictions client, retour d’un paiement sans navigateur, migrations et configuration déployée.

Les fonctions adjacentes observées dans le code ont des dépendances supplémentaires : conseiller IA facultatif/recommandé/obligatoire, recherche de société, avis Google, contrats longue durée Tulip, factures et paiement des prolongations, emails/SMS de rappel et calendrier externe. Leur validation complète exige des scénarios d’intégration dédiés. Le mode sans identifiants de cette recette ne valide pas leur service externe.

## Critères avant déploiement

- Parcours demande et paiement, panier mixte assuré, livraison et acompte cohérents de la fiche au suivi client.
- Aucun défaut bloquant de prix, disponibilité, confidentialité ou double réservation.
- Tests des services externes requis exécutés dans leurs sandboxes, avec preuve côté fournisseur et base.
- Version testée identifiée, résultats mobile/desktop enregistrés, anomalies et cas non exécutés visibles.
- Migrations, configuration de déploiement et vérifications après déploiement traitées séparément.

## Related

- [Lancer l’environnement](storefront-qa.md)
- [Glossaire métier](../domain/glossary.md)
- [Checklist de revue](../code-review/07-checklist.md)
