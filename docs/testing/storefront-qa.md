# Recette locale du storefront

Cet environnement exécute une copie des sources du checkout courant, y compris les modifications non commitées. Il possède sa base MySQL, son stockage MinIO et sa boîte email Mailpit. Les boutiques et réservations sont fictives. Les fichiers `.env` habituels ne sont jamais copiés et les variables du shell ne servent pas de configuration applicative.

## Lancer

Prérequis : Node 22+, pnpm, Docker avec Compose, Localify configuré. Les dépendances du projet doivent avoir été installées avec `pnpm install` : la copie de recette réutilise le cache pnpm en mode hors ligne.

Sur ce Mac, un profil Colima réservé à la recette a été créé. Pour le démarrer :

```sh
colima start louez-storefront-qa --activate=false --cpu 2 --memory 4 --disk 20
```

Depuis la racine du dépôt :

```sh
pnpm qa:storefront setup
pnpm qa:storefront dev
```

Ouvrir [l’index de recette](https://louez-qa.localify/qa/index.html). Il contient les boutiques, les URL des scénarios, les prérequis, le comportement attendu, les liens client et la boîte email. Le serveur reste au premier plan ; `Ctrl+C` arrête uniquement le serveur de recette et ses simulateurs.

Avec un autre moteur Docker, sélectionner son contexte au **premier** setup :

```sh
QA_DOCKER_CONTEXT=desktop-linux pnpm qa:storefront setup
```

`setup` démarre les services, copie les sources, installe les dépendances, configure Localify, applique le schéma Drizzle et insère les données si la base est vide. Il conserve les données déjà présentes. Les ports MySQL, SMTP, stockage et simulateurs sont réservés automatiquement. Le contexte Docker global reste inchangé.

## Tester

1. Filtrer l’index par boutique, texte ou résultat : à tester, validé, anomalie, bloqué. Ces filtres se combinent ; un cas sans résultat enregistré est « À tester ».
2. Ouvrir son lien. Pour un nouveau panier, choisir une période future disponible ; la période « stock » affichée dans l’index sert spécifiquement aux tests de disponibilité.
3. Effectuer les étapes et comparer au résultat attendu, sur ordinateur puis sur mobile.
4. Noter le résultat et les observations. Les résultats sont conservés dans le navigateur de l’index. Le bouton d’export télécharge un JSON daté ; exporter avant de réinitialiser les données.

Le compte client est `client@example.test`, le propriétaire `owner@example.test`. Les codes et liens de connexion arrivent dans Mailpit, accessible depuis l’index. Aucun compte de production n’est nécessaire. Utiliser uniquement des adresses `@example.test` ; l’envoi email de développement est limité à ce domaine et le serveur SMTP local ne relaie pas les messages.

Les liens préparés pour le suivi client ouvrent de vraies sessions sur des réservations fictives. Ils expirent après 90 jours. Les dates de disponibilité, de fermeture et de saison sont calculées à la génération ; refaire un reset lorsque ces dates sont passées.

## Modifier le code avec le hot reload

`pnpm qa:storefront dev` actualise la copie au démarrage, puis suit les fichiers du checkout courant toutes les 750 ms. Modifier et sauvegarder les fichiers habituels dans l’IDE : les composants, styles et packages partagés sont recopiés automatiquement et Next applique Fast Refresh. Aucun `sync` ni reset de la base n’est nécessaire pour ces changements.

Le terminal affiche `[QA sources]` à chaque copie. Les ajouts, suppressions et renommages sont suivis. Les fichiers ignorés par Git, les `.env`, les caches et les rapports générés ne sont pas synchronisés. Les substitutions vers les simulateurs sont réappliquées avant chaque écriture ; si un point de substitution a changé, le terminal signale une erreur et conserve la dernière version valide de ce fichier.

Après un changement de dépendances, installer celles-ci dans le checkout avec `pnpm install`, puis relancer `dev`. Après une modification du lanceur ou des simulateurs dans `scripts/storefront-qa/`, relancer également `dev`. Pour le schéma et les données des scénarios, suivre la procédure ci-dessous.

## Recommencer ou actualiser les sources

Arrêter d’abord `dev` avec `Ctrl+C`.

```sh
# Copier les dernières modifications du chantier ; conserver les réservations
pnpm qa:storefront sync

# Effacer toutes les données de la base de recette et recréer les scénarios
pnpm qa:storefront reset

pnpm qa:storefront dev
```

Le reset concerne **toutes les boutiques de cette recette**. Il ne modifie aucune autre base. Pour effacer uniquement un panier navigateur, utiliser le lien prévu sous la boutique dans l’index. Cette action ne supprime pas les réservations déjà créées. Les tests manuels partagent les stocks d’une boutique : remettre les données à zéro entre campagnes, et utiliser une instance distincte pour une future suite E2E concurrente.

Après un changement de schéma ou de définition des scénarios, faire `sync` puis `reset`. La création du schéma utilise `drizzle-kit push` dans la base jetable : ce dispositif ne valide pas les migrations d’une base de production existante.

```sh
pnpm qa:storefront status
pnpm qa:storefront check
pnpm qa:storefront stop
```

`stop` arrête les trois services Compose de recette sans effacer les volumes. Pour arrêter aussi la VM dédiée, une fois la recette terminée : `colima stop louez-storefront-qa`.

Exécuter `check` pendant que `dev` tourne : il vérifie les réponses HTTP et le contenu attendu de l’index, des 21 boutiques, de Mailpit et des simulateurs. Le résultat daté est écrit dans `.agent-docs/storefront-qa/http-checks.json`. Ce contrôle ne valide pas les parcours métier.

## Services simulés et limites

| Service                                      | Fonctionnement local                                                                                                                | Validation supplémentaire avant déploiement                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe                                       | SDK réel dirigé vers un serveur local ; création de session, montant, succès, refus, annulation et retour impayé                    | Sandbox Stripe Connect réelle : 3DS, webhooks signés, retours concurrents, reprise de paiement, empreinte Stripe Elements et remboursements |
| Tulip                                        | Appels HTTP réels vers un fournisseur local ; produits couverts, devis, contrat fictif ; erreur 503 et délai de 8 s sélectionnables | Compte Tulip de test vérifié : contrat réel de test, tarification, produits autorisés, modifications et annulation                          |
| Google Places / Routes                       | Deux suggestions stables : Paris proche à 5 km, Melun hors zone à 45 km                                                             | Géocodage et distance auprès du service réel, quota et erreurs réseau                                                                       |
| Email                                        | Envoi SMTP réel capturé par Mailpit ; codes et liens utilisables                                                                    | Délivrabilité du fournisseur de production                                                                                                  |
| SMS, push, calendrier externe, analytics, IA | Aucun identifiant réel transmis à l’instance                                                                                        | Recette d’intégration séparée si le changement concerne ces fonctions                                                                       |

Les substitutions de transport Stripe et Google sont appliquées **uniquement à la copie jetable des sources**. Elles ne remplacent ni le calcul des prix, ni la disponibilité, ni la création de réservation, ni la confirmation de paiement. Le lanceur échoue si les points de substitution attendus ont disparu. Tulip utilise son paramètre de base URL existant. Les requêtes non prises en charge par les simulateurs échouent explicitement.

Le simulateur Stripe affiche son propre écran, sans formulaire bancaire. Il ne prouve pas que Stripe acceptera une requête ou un paiement. Le statut des cautions est préparé en base pour vérifier l’affichage ; la capture réelle d’une empreinte n’est pas simulée. Aucun résultat de scénario n’est marqué « validé » par le simple fait d’avoir été généré.

Pendant `dev`, les sources évoluent avec le checkout : les résultats d’une campagne manuelle peuvent donc concerner plusieurs versions du code. Cette instance n’est pas un déploiement ni une preuve de compatibilité des migrations. Ne pas exposer cette copie publiquement : l’index comporte des accès aux clients fictifs et les simulateurs sont destinés à la machine locale.

## Où se trouvent les fichiers

- `scripts/storefront-qa/` : lanceur et simulateurs, indépendants du serveur de développement habituel.
- `docker/compose.storefront-qa.yml` : services locaux, volumes propres au projet Compose `louez-storefront-qa`.
- `apps/web/scripts/storefront-qa/scenarios.ts` : boutiques et matrice versionnées.
- `apps/web/scripts/storefront-qa/seed.ts` : données synthétiques et liens de recette.
- `.agent-docs/storefront-qa/` : copie des sources, configuration privée, manifeste et rapport générés. Ce répertoire est ignoré par Git.

Pour ajouter un cas, modifier la matrice et, si nécessaire, les données du seed ; exécuter `sync`, `reset`, puis vérifier le cas dans le navigateur. Les identifiants de produits restent stables entre resets. Les jetons d’accès client sont renouvelés.

## Related

- [Inventaire des fonctionnalités](storefront-coverage.md)
- [Architecture](../ARCHITECTURE.md)
- [Isolation des tests Playwright](https://playwright.dev/docs/best-practices)
- [Isolation par projet Docker Compose](https://docs.docker.com/compose/how-tos/project-name/)
- [Tests Stripe Connect](https://docs.stripe.com/connect/testing)
