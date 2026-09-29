# Démonstrations de la landing

La landing Aside du site marketing charge les démonstrations depuis l’application Louez, dans des iframes. Les écrans de démonstration et le produit importent les mêmes composants. Une mise à jour déployée de ces composants apparaît donc dans la landing au prochain chargement de la démo.

## Source partagée

| Scène       | Composants utilisés dans Louez et dans la démo                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boutique    | `CatalogLayout`, `CatalogSidebar`, `ProductGridView`, `ProductCard`, `StoreHeader`, `HeaderSearchCapsuleView`, `RentalPeriodPicker`, `CartDrawerView`, `CartPanelView`, `CartLineItem`                      |
| Gestion     | `DashboardNavigation`, `DashboardContentFrame`, `AdaptiveHeader`, `DashboardStatCard`, `ActivityCardView`, `ReservationsTableView`, `ReservationsCalendarView`, `TimelineToolbar`, `TimelineReservationBar` |
| Réservation | `ReservationDetailClient` et sa composition complète                                                                                                                                                        |
| Conseiller  | `AdvisorPanel`, ses messages et son champ de saisie                                                                                                                                                         |

Les vues extraites conservent leur rendu. Le produit garde ses requêtes, ses règles de disponibilité, ses mutations et ses contrôles d’accès dans les composants qui les appellent. Les scènes de démonstration fournissent des fixtures et des callbacks locaux. Elles ne testent pas un paiement, un contrat ou une réservation réelle.

Le site marketing conserve uniquement le cadre, les contrôles et le lecteur `postMessage`. Il ne copie ni les styles ni le JSX de l’application. Les cadrages des scènes et le scénario restent propres à la landing : un changement important de navigation produit peut demander de revoir ces scénarios.

## Routes et intégration

- `/demos/landing/rental` : parcours en trois étapes.
- `/demos/landing/storefront?compact=1`, `/planning?compact=1`, `/reservation?compact=1` sous le même préfixe : petites démonstrations.
- `/demos/landing/advisor` : conversation avec des réponses de démonstration.
- `/demos/landing/planning-timeline` et les autres scènes des pages fonctionnalité : voir plus bas.

Le marketing utilise `NEXT_PUBLIC_LOUEZ_DEMO_URL`, avec `https://app.louez.io` par défaut en production. Cette variable est résolue au build du marketing et doit aussi être autorisée par son `frame-src`. Le build de l’app qui contient les routes doit être déployé avant la landing qui les intègre.

### Autoriser une landing sur un autre domaine

L’app autorise par défaut `https://{NEXT_PUBLIC_APP_DOMAIN}` et sa version `www`.
Pour intégrer les démos dans une landing de préproduction, ajouter dans
l’environnement de **l’app Louez** :

```dotenv
NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS=https://louez.d5.lumy.cloud
```

Plusieurs origines HTTPS peuvent être séparées par des virgules. Indiquer
l’origine seule, sans chemin comme `/fr`. La même liste sert à la CSP
`frame-ancestors` et aux commandes `postMessage` du lecteur. Les domaines
supplémentaires ne donnent aucun droit d’intégration aux pages métier.

Cette valeur passe par la configuration publique fournie par le serveur au
navigateur. Elle est lue au démarrage du conteneur : après le premier déploiement
du code qui la prend en charge, un redémarrage avec la nouvelle valeur suffit.
La landing conserve `NEXT_PUBLIC_LOUEZ_DEMO_URL=https://app.louez.app` lorsqu’elle
charge les démos depuis cette app ; sa variable reste résolue au build.

En local, l’origine est `https://landing-demos.louez.localify`. Le serveur de démo appartient au worktree `louez-landing-demos`, branche `feat/synchronized-landing-demos`. Depuis `apps/web`, avec une configuration locale sans données réelles :

```sh
localify dev web --project louez --env landing-demos -- pnpm exec next dev --hostname 127.0.0.1
```

## Lecture et prise en main

Les scènes à une vue durent 4,6 secondes. « Vous préparez » dure 10,2 secondes et montre successivement le dashboard, la liste puis le calendrier, soit environ trois secondes par vue. Le curseur animé actionne les vrais contrôles. La lecture s’arrête au survol, pendant l’usage du clavier, hors écran et dans un onglet masqué. Elle reprend à la sortie du curseur. Un contact tactile met la lecture en pause ; le bouton Lecture permet de la relancer. La préférence système de réduction des animations désactive la lecture automatique.

Le catalogue propose douze produits illustrés et les filtres du storefront. L’ajout ouvre directement son panier, sans configurateur. Le visiteur peut modifier les quantités, retirer un produit ou continuer ses achats. Le bouton de commande est désactivé dans la démo. Les produits, les quantités et les dates choisies suivent le parcours jusqu’au dossier de réservation. Chaque petite scène peut aussi être manipulée séparément. Aucune donnée métier n’est enregistrée.

Les trois cartes affichent chacune un viewport de 1 440 × 1 000 px, réduit par le marketing à la largeur disponible. Le contenu reste celui de la page complète, avec son menu, plutôt qu’un extrait de widgets. La grande démonstration utilise aussi ce viewport desktop réduit. Les dialogues agrandis suivent la largeur disponible.

La liste et le calendrier présentent 24 réservations fictives issues du même modèle. Le tri, les filtres du calendrier, le défilement et l’ouverture d’un dossier fonctionnent localement. La vue calendrier accepte des réservations fournies par son appelant : dans ce cas, elle ne lance aucune requête métier. La création par glisser-déposer et le bouton de création sont désactivés dans la démo. Le calendrier de l’application garde ses requêtes et ses actions habituelles par défaut.

## Limites de la route publique

Le proxy traite ces routes avant la résolution d’une boutique et n’autorise que GET et HEAD. Le marqueur interne de rendu ne peut pas être fourni par une requête externe. Le layout de démonstration n’installe pas les providers métier ni les traceurs de l’app. Les origines de la landing sont explicitement autorisées pour l’intégration ; la protection des pages de compte et de gestion reste inchangée.

La CSP des démonstrations autorise les requêtes de rendu Next.js sous `/demos/landing/`, et les ressources de développement lorsque nécessaire. Elle n’autorise pas les appels aux API métier. Le panier et le conseiller désactivent leur prise de focus automatique et leur modalité dans les démos pour permettre au visiteur de sortir du cadre.

## Validation locale du 15 septembre 2026

- Build complet de Louez réussi après partage du cadre, de la navigation, de la liste et du calendrier. Le marketing continue de charger ces scènes depuis l’application.
- TypeScript et lint ciblé réussis.
- Quatorze tests du périmètre public, des en-têtes, du lecteur et du panier : plusieurs produits, limites de stock, retrait et changement de période.
- Navigateur : douze photos chargées, filtre par catégorie, ajout direct au panier, quantité modifiée à deux vélos pour 40 € et 300 € de caution, commande désactivée. Panier mobile testé à 390 px sans débordement horizontal.
- Miniatures : viewport interne de 1 440 px, réduit à 326 px dans une grille desktop de trois cartes ; viewport conservé sur mobile, sans débordement de la landing.
- Liste et calendrier : navigation au clavier et à la souris, défilement horizontal et vertical, ouverture du dossier #1048 avec deux vélos longtail, 367,50 € de location et 700 € de caution.
- Calendrier à 390 px : document de 390 px et zone défilable de 356 px ; aucune largeur supplémentaire imposée à la page.
- Survol et sortie vérifiés dans le navigateur : pause puis reprise ; le message de sortie du cadre lève aussi la pause liée au clavier.

Ces vérifications concernent le code et les serveurs locaux. Aucun déploiement n’a été effectué.

## Agrandissement et détail de réservation — 16 septembre 2026

Chaque carte propose « Agrandir ». Le dialogue du marketing charge la même scène à la largeur disponible ; les miniatures sont déchargées pendant l’ouverture pour laisser les ressources au dialogue. La croix et Échap ferment le dialogue, puis le focus revient au bouton d’ouverture. Échap ferme d’abord un panier ou un menu ouvert dans la démo.

La scène réservation rend maintenant `ReservationDetailClient`, le composant de la page `/dashboard/reservations/[id]`. Elle conserve sa composition complète : en-tête et actions, client, articles, historique, factures, suivi, notes, retrait et retour, paiements et caution. Les fixtures reprennent le client, les produits, les dates et les montants de la ligne sélectionnée. Une réservation en attente ne présente ni paiement reçu ni facture.

L’option `readOnly`, désactivée par défaut dans l’application, coupe le rafraîchissement de la réservation, les requêtes de carte bancaire, les suggestions de parrainage et la conversation réelle du conseiller. Elle désactive les actions métier, les téléchargements et la modification des notes. Les historiques, la navigation locale et le défilement restent disponibles. Les protections du proxy et de la CSP restent en place.

Validation locale : build de l’app et TypeScript réussis, lint ciblé réussi, seize tests passants. Dans le navigateur : trois dialogues ouverts, panier utilisable, historique dépliable, fermeture au clavier avec retour du focus, version mobile de 390 px sans débordement horizontal. Le chargement de la réservation ne déclenche aucun appel aux API métier. Aucun déploiement.

## Chargement, captures et scroll — 17 septembre 2026

Les scènes sont importées à la demande. Le parcours en trois étapes prépare la
suivante pendant la lecture, et le curseur attend que la vue soit prête. Les
traductions envoyées dépendent de la scène : 80 ko pour la boutique, 112 ko pour
la gestion, 174 ko pour le parcours complet et 5,5 ko pour le conseiller,
contre 359 ko pour le dictionnaire français entier, avant compression.

Le marketing affiche une capture WebP avant de charger l’iframe près de l’écran.
Il garde deux démos chargées au maximum, avec une seule en lecture. Le dialogue
agrandi devient la seule iframe chargée. Une démo éloignée est retirée puis
repart du début au retour ; le choix de pause manuelle reste conservé.

Le message de contrôle `scrollPage` distingue aperçu et dialogue. Dans un
aperçu, `useParentScroll` transmet le mouvement vertical à la landing avec
`louez:demo:scroll`. Le parent vérifie l’origine et l’iframe émettrice. Les clics,
le zoom et le défilement horizontal restent disponibles. En grand ou sur une
route ouverte seule, le défilement reste interne à l’app.

Les captures sont dans `apps/web/public/demo-posters`. Le stage `demo-posters`
de `docker/Dockerfile.web` les régénère depuis le build de production. Son
serveur utilise les fixtures, sans URL de base de données ; Chromium reste
dans le stage de build. Pour les régénérer après un build local :

```sh
pnpm --filter @louez/web demo:posters --start --browser /chemin/vers/chromium
```

Le paramètre `?poster=1` immobilise les scènes. Le script attend les composants,
les polices et les images visibles, et échoue si une page signale une erreur.
Déployer les routes et les captures côté app avant la landing.

Validation : build de production, TypeScript, lint et treize tests ciblés
passants. Les quatre scènes ont été vérifiées dans le navigateur sur le build
de production. Sur la landing locale, la molette traverse les aperçus et le
dialogue conserve son scroll. La génération Docker complète, le tactile sur
appareil et PageSpeed en production restent à vérifier. Aucun déploiement.

## Langues — 17 septembre 2026

La landing existe en huit langues et passe la sienne à chaque iframe : `/demos/landing/<scène>?locale=en`. La page valide la valeur avec `getDemoLocale` (`lib/landing-demos/text.ts`) et retombe sur le français si elle manque ou n’est pas une langue de l’app. Le cookie `NEXT_LOCALE` et `Accept-Language` ne comptent pas ici : dans une iframe, c’est la page hôte qui décide.

Deux sources de texte suivent cette langue. Les messages de l’app viennent de `messages/<locale>.json`, découpés par scène comme avant (`getDemoMessages(scene, messages)`). Ce que les messages ne couvrent pas est dans `getDemoText(locale)` : noms des produits et des catégories, libellés de l’historique, notes du dossier, réponse du conseiller, étapes et curseur de l’hôte. Les fixtures gardent leurs identifiants, prix et photos ; `getDemoProducts(locale)` et `getDemoCategories(locale)` ne changent que les noms. Côté client, les scènes lisent la langue avec `useDemoLocale`. Le nom de la boutique, les clients et l’adresse restent français : c’est une boutique de Nantes. Devise et fuseau ne changent pas non plus.

`searchParams` n’est lu que dans `DemoContent`, sous `<Suspense>`. Le lire dans `generateMetadata` ou dans le composant de page bloque la route avec `cacheComponents` ; le titre de la page est donc neutre (« Louez ») et le repli du Suspense n’a pas de texte.

Les captures existent par langue : `<scène>.<locale>.webp`, plus `<scène>.webp` en français pour une landing déployée avant ce changement. La landing demande la capture de sa langue et retombe sur la française si elle manque. Le script en produit 32 ; contre le serveur de dev, la première passe peut dépasser le délai d’attente pendant la compilation, la relancer suffit. Les traductions de `text.ts` n’ont pas été relues par des locuteurs natifs.

## Préchargement du compte dans la démo

La scène boutique passe `accountPrefetch={false}` au header partagé. Cette
option atteint les liens de `HeaderAccountButton` et désactive leur
préchargement automatique et au survol. La vraie boutique conserve le
comportement Next.js par défaut. Les clics du header restent interceptés par
la scène de démonstration.

Sans cette option, le lien de connexion lançait une requête RSC vers
`/account/login` dès son affichage dans le build de production. La CSP des
démos la bloquait et le script de capture faisait échouer le build Docker.
Le 17 septembre 2026, la commande `demo:posters --start --browser …` a reproduit
cette erreur avant le correctif, puis généré les quatre captures sans erreur
après reconstruction. La CSP n'a pas été élargie. Le parcours Docker complet
reste à vérifier : le moteur Docker local n'était pas disponible.

## Scènes des pages fonctionnalité — 18 et 19 septembre 2026

Le site marketing intègre aussi des scènes sur ses onze pages fonctionnalité, par le même lecteur et la même route `/demos/landing/<scène>`. Leurs noms sont dans `FEATURE_DEMO_SCENES` (`lib/landing-demos/policy.ts`).

### Une scène

- `components/landing-demos/features/<scène>.tsx` : le composant, qui compose les composants du produit avec des fixtures. Il reçoit `FeatureSceneProps` (`feature-demo.types.ts`).
- `components/landing-demos/features/<scène>.demo.ts` : `actor` (qui tient le curseur), `duration`, `format` (`"phone"` pour une page de 390 × 844) et `cues`. Ce fichier n’importe que des types : un test node le charge.
- Enregistrement : `policy.ts` (nom), `feature-demos.ts` (script), `demo-scene-loaders.ts` (import différé), `feature-scene.tsx` (choix de l’écran), `messages.ts` (chemins de traduction embarqués), `scripts/landing-demo-posters.mjs` (listes `scenes` et `phoneScenes`). Deux tests vérifient que les listes du script suivent le registre.
- Une scène de page fonctionnalité occupe l’étape 0 ; ouvrir un dossier depuis elle mène à la scène réservation, comme dans le parcours de la landing.

### Gestes du curseur (`use-demo-playback.ts`, `demo-gestures.ts`)

Un cue déplace d’abord le curseur vers sa cible, puis un cue suivant agit : `click`, `press` (appui complet, pour les sélecteurs et menus qui s’ouvrent à l’appui), `hover` (jusqu’au cue suivant), `scroll`, `type` (saisie lettre à lettre, sans prendre le focus), `draw` (trait de signature sur un canvas), `emit` + `useDemoCue` quand aucun contrôle du produit ne fait avancer la scène (de l’email reçu à la page qu’il ouvre, par exemple). Les événements ne sont pas « trusted » : l’hôte ne les confond pas avec un visiteur qui prend la main. Les cibles sont des attributs `data-*`, jamais un texte ni un `aria-label`.

### Cadres

`DashboardSceneFrame` reçoit la page active parmi les entrées du menu et la liste `pages` des entrées cliquables. Avec `pathname` (`/dashboard/products/demo-city-bike`), la barre du haut affiche le vrai fil d’Ariane, alimenté par le `DashboardBreadcrumbLabel` de la page. `SettingsSceneFrame` reproduit la mise en page des réglages avec le vrai `SettingsNav`. Pour cela, `DashboardBreadcrumbs`, son provider et `SettingsNav` acceptent un chemin fourni et une navigation inerte.

Le `StoreProvider` des démos déclare le rôle `owner` : le visiteur regarde le propriétaire de la boutique, et les contrôles réservés à `manage_settings` restent actifs. `SettingsSceneFrame` enveloppe la page dans `StoreSettingsAccess`, comme la mise en page des réglages.

### Ce qui a changé dans le produit

Les scènes ne redessinent rien. Là où un composant chargeait ou écrivait des données, il accepte des données fournies et un mode lecture seule (`readOnly`, callbacks injectés), avec un comportement par défaut inchangé. Là où le JSX d’une page vivait dans un composant serveur, il a été extrait dans une vue que la page et la scène rendent toutes deux : fiche produit (stats, inventaire, infos, repères), fiche client, page Ventes des analyses, page Équipe, vue multi-boutiques, réglages de livraison, de notifications et de codes promo, page produit de la boutique (panneau de réservation, accessoires), checkout, espace client. Aucune scène ne monte de carte ni d’autocomplétion d’adresse : la CSP des démos n’a pas été élargie.

`createDemoReservationPages(…, busy)` ajoute aux 24 réservations une semaine chargée autour d’aujourd’hui sur les premiers produits, sans dépasser le stock. La landing ne l’utilise pas. `getDemoCustomer` donne douze noms distincts et des emails nominatifs. La boutique fictive a une seule adresse partout : 12 rue des Cyclistes, 44000 Nantes.

### Le contrat PDF

L’app n’a pas de lecteur PDF : « Télécharger le contrat » ouvre un onglet. Les scènes `contract-*` affichent donc les pages du vrai contrat en images.

`pnpm --filter @louez/web demo:documents` (`scripts/landing-demo-documents.mts`) rend le vrai `ContractDocument` en PDF dans chaque langue (`.demo-documents/`, ignoré), avec les fixtures du dossier de démonstration, puis convertit chaque page en `public/demo-documents/contract.<langue>.p<n>.webp`. Il écrit aussi `manifest.json` (nombre de pages) et `reservation.json`, l’instantané de dates que les scènes importent pour que le dossier affiché corresponde à son PDF. La conversion utilise `pdftoppm` (poppler) quand il est installé, sinon PDFKit sur macOS (`scripts/pdf-pages.swift`).

Le Dockerfile lance ce script dans l’étape `builder`, avant `next build`, après avoir installé `poppler-utils` : les images et le bundle portent la date du build, et les dates restent actuelles à chaque déploiement. Les images commitées ne servent qu’au développement local.

Le build ne connaît pas `NEXT_PUBLIC_APP_DOMAIN`, lue à l’exécution : le script la fixe à `louez.io`, sinon le lien des conditions s’imprimait `maison-du-velo.undefined/terms`.

### Signature du client sur le contrat

Le bloc « Client » du contrat distingue trois cas :

- une réservation faite sur la boutique (`source: "online"`), dont le paiement exige d’accepter les conditions (`acceptCgv`), est « Signé à la réservation » : l’acceptation vaut signature. Le bloc imprime « Signé le » (création de la réservation) et, une fois le contrat validé, « Validé le » ;
- un client qui a réellement signé (hors validation automatique) garde « Signé », avec la date et l’IP ;
- les autres validations automatiques (réservation créée par le loueur, marketplace) restent « Validé automatiquement ».

Le dossier de démonstration est une réservation en ligne. L’aperçu `contract-at-booking` montre ce cas.

### Police des PDF

Contrats, factures et rapports d’état des lieux embarquent Inter 4.1 (`public/fonts/pdf/`, licence SIL OFL dans `OFL.txt`), enregistrée par `lib/pdf/fonts.ts`. Helvetica, la police intégrée de react-pdf, n’a pas les lettres ą, ę, ł ou ś : les documents polonais et les noms comme « Łukasz » s’imprimaient cassés (« wrze[nia » pour « września »). Le fichier est cherché sous `public/` depuis `apps/web` (développement, scripts) et depuis la racine du monorepo (image standalone). `lib/pdf/fonts.test.ts` rend chaque PDF d’aperçu et vérifie qu’il embarque Inter et plus Helvetica.

Un script qui charge les modules de l’app en CommonJS doit aussi prendre `renderToBuffer` par `require` : un `import` ESM charge une seconde copie de react-pdf, où la police n’est pas enregistrée.

Au passage, le contrat imprimait la clé brute des paiements sans libellé (`deposit_hold`…) et « En attente » pour une empreinte autorisée. `contract.paymentTypes` et `contract.paymentStatus.authorized` existent maintenant dans les 8 langues.

### Clés API : droits domaine par domaine

La création d’une clé proposait trois préréglages et affichait le détail des sept domaines sans pouvoir le modifier, alors que l’API acceptait déjà toute combinaison. Chaque domaine a maintenant son sélecteur (aucun accès, lecture, lecture et écriture ; les analyses n’ont pas d’écriture). Le préréglage affiché devient « Personnalisé » dès qu’un domaine s’en écarte. Libellés dans `dashboard.settings.api.domains`, `levels` et `presetCustom`, 8 langues. Le corps de la fenêtre a aussi retrouvé sa marge (`DialogPanel`).

### Captures

`--scenes a,b` ne redessine que ces scènes et conserve les tailles des autres dans le manifeste. Les scènes téléphone sont capturées en 390 × 844. Une image en chargement différé qui ne fait qu’effleurer le bas du cadre n’est plus attendue.

```sh
pnpm --filter @louez/web demo:posters --base-url https://<origine-de-l-app> --browser /chemin/vers/chrome --scenes planning-timeline
```

### Aperçu hors Localify

L’intégration en iframe a été vérifiée par un aperçu `tailscale serve` : l’origine du site dans `NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS`, celle de l’app dans `NEXT_PUBLIC_APP_URL`. La CSP de développement des démos autorise pour cela le websocket de la propre origine du serveur de dev (`wss://<origine>/_next/`) ; auparavant l’app ne s’hydratait dans l’iframe que derrière `localhost` ou `*.localify`. Elle autorise aussi `/__nextjs_source-map` et `/__nextjs_original-stack-frames` : quand les DevTools sont ouverts, React y résout les avertissements du rendu serveur rejoués dans le navigateur, et chaque requête bloquée remplissait la console d’erreurs CSP. La CSP de production est inchangée.

### Validation

TypeScript, oxlint sur tous les fichiers modifiés ou créés, audit de duplication, 108 tests du périmètre démo et 273 tests voisins du code produit modifié. Chaque scène a été ouverte seule dans Chrome sur le serveur de développement (aucune erreur console, script joué jusqu’au bout), puis dans les pages du site. Les captures des 8 langues sont générées sans erreur. Non vérifié : build de production, génération Docker, appareil tactile. Aucun déploiement, aucun commit.

Trois petits défauts du produit corrigés au passage : le sélecteur de préréglage des clés API affichait sa valeur brute ; les points de progression de l’état des lieux lisaient une clé de traduction inexistante ; l’aide « Variables : {storeName}… » de l’éditeur de gabarit SMS déclenchait une erreur de formatage.

## Related

- [Architecture](ARCHITECTURE.md)
- [Frontend](from-scratch/05-frontend.md)
- [Contrôles avant commit](code-review/07-checklist.md)
