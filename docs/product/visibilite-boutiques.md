# Visibilité des boutiques — trouver ses premiers clients

Statut : spec ; phase 1 livrée, phase 3 « Être trouvé par les IA » avancée et en revue (novembre 2026).
Propriétaire : Téo.

## Problème

Une boutique Louez peut être complète (produits, prix, paiement en ligne) et ne recevoir aucune
réservation : personne ne sait qu'elle existe. Les données d'activation suivies dans PostHog
montrent que la plupart des comptes terminent l'onboarding, qu'une partie seulement crée un
produit, et que la chute la plus forte est entre « boutique prête » et « première réservation
d'un vrai client ». Les chiffres exacts restent hors de ce dépôt public (voir `.agent-docs/`).

Les cofondateurs ont fixé le 18 novembre 2026 l'activation comme priorité n° 1 et nommé le
besoin réel des loueurs : **être vus**. Les fonctions de ce document sont **gratuites pour
toutes les boutiques** : c'est un levier d'activation, pas de revenu. La monétisation viendra
plus tard, à part.

## Pour qui

Le loueur d'une petite boutique de location (vélos, kayaks, matériel de réception, outillage,
matériel photo…), souvent seul, souvent sur son téléphone. Il n'est pas expert du web. Ses
premiers clients viennent rarement de Google la première semaine : ils viennent de **son réseau
existant** (clients habituels, voisins, groupes WhatsApp, abonnés Instagram/Facebook), de **sa
vitrine physique** et de **sa fiche Google Maps**, que beaucoup ont déjà sans lien de
réservation.

Ce que le loueur veut faire : « Je veux que les gens qui me connaissent déjà puissent réserver
en ligne, et que ceux qui me cherchent me trouvent. » Ce dont il a besoin : savoir **quoi faire
maintenant**, et avoir **l'outil prêt** (le texte à coller, l'affiche à imprimer, le lien à
mettre sur Google) sans réfléchir.

## Ce qui existe déjà

**Référencement de chaque boutique** (`apps/web/lib/seo.tsx`, `app/sitemap.ts`, `app/robots.ts`,
`lib/util.sitemap.ts`, `lib/search-indexing.ts`) — déjà solide :

- `LocalBusiness` JSON-LD (adresse, coordonnées, horaires, carte, réseaux sociaux `sameAs`),
  `WebSite` avec `SearchAction`, `BreadcrumbList`, `ItemList` du catalogue ;
- `Product` + `Offer` JSON-LD **avec le prix de location par période**
  (`UnitPriceSpecification`, `businessFunction: LeaseOut`, période en codes UN/ECE), prix après
  promotion ;
- titres, descriptions, `canonical`, OpenGraph/Twitter (image de partage, photo d'accueil ou
  logo), `og:locale` par langue ;
- sitemap par boutique (accueil, catalogue, catégories non vides, produits actifs, pages
  d'information), `robots.txt` par hôte, interrupteur `LOUEZ_SEARCH_INDEXING` pour les
  instances de test ;
- éditeur SEO dans la boutique en ligne (`/online-store/seo`).

**Mesure des visites** : `page_views` (référent `document.referrer`, appareil, page) et
`storefront_events`, page « Trafic » du dashboard. Le référent est enregistré mais **jamais
montré** au loueur.

**Partage** : carte « Votre boutique » de l'accueil (`components/dashboard/home/storefront-widget.tsx`)
avec copie du lien et une fenêtre de partage (`share-modal.tsx`) : WhatsApp, e-mail, SMS, et un
QR code téléchargeable en PNG. Les messages sont génériques et le QR n'est pas une affiche.

**Site existant** : widget intégrable (iframe) dans Réglages → Intégrations → Widget.

**reeent** : canal de publication sur la marketplace (Réglages → Canaux de vente), avec sa
propre checklist de publication (`packages/api/src/services/marketplace-channel.ts`). Réservé
à la plateforme (`MARKETPLACE_URL`).

**Guidage** : la checklist de lancement de l'accueil (`setup-checklist.tsx`, données de
`stores.getLaunchChecklist`) s'arrête à « première réservation » ; la réservation test (#211)
apprend à gérer une réservation. Rien ne guide le loueur **après la mise en ligne** pour faire
venir des clients.

## Ce qui manque

1. Un **guide d'action après la mise en ligne** : quelles actions font venir les premiers
   clients, dans quel ordre, avec l'outil prêt.
2. Des **textes prêts à coller** par canal, dans la langue du loueur.
3. Une **affiche imprimable** (QR + nom + « Réservez en ligne ») pour le comptoir ou la vitrine.
4. Le **lien de réservation sur Google Maps** : la fiche Google Business Profile accepte un lien
   de réservation ; rien n'explique comment l'ajouter.
5. Un **bouton « Réserver » simple** pour un site existant (le widget iframe est lourd pour un
   site vitrine qui veut juste un bouton).
6. La **source des visites** montrée au loueur (Google, réseaux, QR, assistants IA).
7. Une **mesure** : savoir si ces actions augmentent les premières réservations.

## Proposition par phase

### Phase 1 — « Se faire connaître » (cette semaine)

Le plus petit ensemble qui peut plausiblement déplacer la première réservation : faire passer
le loueur à l'action **là où sont ses premiers clients** (son réseau, son comptoir, sa fiche
Google), et lui montrer les visites que chaque action lui apporte. Revue après les critiques de
Codex et Grok (annexe) : trois actions au lieu de six, rien coché au simple copier, attribution
des visites dès cette phase.

**Une page `/dashboard/visibility` « Se faire connaître »**, trois actions. Une ligne par action
(titre, une phrase « pourquoi », un bouton) ; l'outil s'ouvre dans une fenêtre, pour que la page
se lise d'un coup d'œil.

| Étape (`step`)    | Ce que fait le loueur                                                                                                                                                                                | Statut                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `share_contacts`  | Envoie le lien à des gens qu'il connaît : WhatsApp, SMS, e-mail, Facebook (groupes locaux), lien à copier ; le lien de la boutique **ou d'un produit** précis                                        | il dit « C'est fait », ou « Pas pour moi » |
| `qr_poster`       | Enregistre l'**affiche en PNG** (A4 : nom de la boutique, « Réservez en ligne », QR, adresse courte), l'imprime ou la montre sur son téléphone                                                       | idem                                       |
| `google_business` | Met le lien sur sa **fiche Google** : champ « Site web » d'abord (présent pour toutes les catégories), « Réservations » quand Google le propose ; bouton vers Google Business Profile, lien à copier | idem                                       |

Chaque étape a trois états : à faire, faite, pas pour moi (« je n'ai pas de comptoir », « pas
de fiche Google »). Ouvrir un canal ou copier un texte ne coche rien : copier n'est pas envoyer.

**Les liens du kit portent leur source** : `?via=whatsapp|sms|email|facebook|copy|qr|google`.
La boutique enregistre la source à la première page de la visite (`page_views.source`, et
`source` dans les métadonnées des `storefront_events`, donc sur le checkout). Le paramètre
`ref` est déjà pris par le parrainage (`proxy.ts`), d'où `via`. La page affiche « Visites
venues de vos partages » (28 jours, par source) : la preuve, pour le loueur, que l'action a
servi, et pour nous une mesure directe.

**Une carte sur l'accueil**, quand la boutique est en ligne et a un produit actif : la
**prochaine action seulement** et un bouton. Elle se ferme pour de bon
(`users.dismissed_notices`) et disparaît quand les trois étapes sont faites ou écartées. Elle
est l'une des cartes « prochaine étape » de l'accueil, qui n'en montre qu'une
([accueil-prochaine-etape.md](accueil-prochaine-etape.md)) : elle vient après la réservation
test et porte la ligne de l'offre de lancement reeent.

**Une seule fenêtre de partage** dans le dashboard : celle de la carte « Votre boutique »
devient l'outil de `share_contacts` (liens marqués, Facebook en plus ; le QR nu laisse place à
l'affiche, sur la page du guide) et mène à « Se faire connaître ». La fin de la réservation test
mène directement à la page du guide.

**Autres canaux**, en bas de la page, en liens simples sans case à cocher : reeent (Réglages →
Canaux de vente ; masqué sans `MARKETPLACE_URL`) et le widget pour un site existant.

**Données** : une table `store_visibility_steps` (boutique, étape, statut `done` | `skipped`,
utilisateur, date), une ligne par étape décidée ; une colonne `page_views.source`. Deux
procédures `visibility.get` et `visibility.setStep` (session du dashboard seulement, non
exposées au MCP en phase 1 : c'est un guide d'interface).

**Textes** : les 13 langues du dashboard, courts, avec le nom de la boutique (ou du produit) et
le lien.

**Préalable** : la réservation test (#211) sert de contrôle « un inconnu réserve sur mobile » ;
la carte « Se faire connaître » n'apparaît qu'avec un produit actif, après elle sur l'accueil.

**Instance auto-hébergée** : tout marche sauf le lien reeent (masqué). Sans PostHog, rien ne
part ; la table et `page_views.source` suffisent à mesurer.

### Phase 2 — Savoir d'où viennent les visiteurs (2–3 semaines)

- **Source des visites sans `via`** dans la page Trafic : classement du référent existant
  (`page_views.referrer`) en Google, réseaux sociaux, assistants IA (chatgpt.com,
  perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com), reeent, direct. Le
  référent seul ne distingue pas bien Google Search de Google Maps, et WhatsApp ou un QR n'en
  envoient pas : c'est pourquoi `via` arrive dès la phase 1.
- **Retours automatiques sur la checklist** : proposer « C'est fait » quand une visite
  `via=qr` ou `via=google` arrive.
- **Réseaux sociaux et site** : textes de bio et de post, bouton « Réserver » HTML simple, si
  les données de `via=copy` montrent que ces canaux servent.
- **Petits correctifs SEO** : descriptions et titres par défaut encore en français en dur
  (`generateStoreMetadata`, `generateProductMetadata`), `priceRange: "$$"` codé en dur, ville
  dans le titre de l'accueil (« Location de vélos à Vannes »), image OpenGraph générée quand la
  boutique n'en a aucune.
- **Lecture par les agents** : `visibility.get` exposée en lecture (MCP), pour qu'un assistant
  aide le loueur à faire les étapes.

### Phase 3 — Moteurs et assistants

- **« Être trouvé par les IA »** : avancé avant la phase 2 à la demande de Téo (18 novembre
  2026), décrit dans la section suivante.
- Avis Google : relier le Review Booster existant à la fiche Google du loueur.
- Google Business Profile par API : l'API ne permet pas de gérer les liens de réservation
  locaux (aide Google), donc pas d'intégration ; le guide manuel reste la voie.
- Annuaires locaux et offices de tourisme (liste par pays).

## « Être trouvé par les IA » (phase 3, avancée)

Les assistants (ChatGPT, Perplexity, Claude, Gemini, Copilot) répondent de plus en plus à
« où louer un vélo à Vannes ? ». Ils citent ce qu'ils comprennent : une boutique dont les
données sont complètes et lisibles par une machine. Cette partie rend chaque boutique lisible,
mesure ce qui en vient, et dit au loueur ce qui manque.

### Ce que lisent les machines

- **`/llms.txt` et `/llms-full.txt`** à la racine de chaque boutique (format llmstxt.org), dans la
  langue de la boutique (`settings.locale`) : résumé, adresse, plan, contact, horaires, règles de
  réservation (paiement ou demande, acompte, durées minimale et maximale, délai de
  prévenance), retrait et livraison, devise, puis le catalogue par catégorie avec chaque tarif
  de la grille (« 25 € / 1 jour ; 120 € / 1 semaine », promotion comprise, comme la page) et la
  caution, chaque produit lié à sa page. `llms-full.txt` ajoute les descriptions. Plafond :
  300 produits (1 000 dans le fichier complet), au-delà le fichier renvoie au catalogue.
  `X-Robots-Tag: noindex` : le fichier sert aux assistants, la page à citer reste la boutique.
  404 hors d'un hôte de boutique, avec `LOUEZ_SEARCH_INDEXING=off`, ou pour une boutique sans
  le droit (`canUseAiVisibility`). Une boutique pas encore en ligne n'a ni page ni fichier.
- **JSON-LD produit** : une `Offer` par tarif de la grille (au lieu du seul tarif de base),
  chacune avec sa `UnitPriceSpecification` et sa période, prix arrondis au centime ; la caution
  en `additionalProperty`. Aucune note ni avis inventés. Le `priceRange: "$$"` codé en dur du
  `LocalBusiness` est retiré : une valeur fausse est pire que rien.
- **Métadonnées** : plus de description par défaut en français dans `generateStoreMetadata`
  (la description traduite du layout s'applique) ; titre et description d'une page produit
  toujours traduits.
- **`hreflang`** : non émis, volontairement. Une page de boutique a une seule URL, servie dans la
  langue du visiteur (`Accept-Language`) ou celle de la boutique ; `hreflang` exige une URL par
  langue. Les robots lisent la langue de la boutique.
- **robots.txt** : un groupe nomme les robots des assistants (GPTBot, OAI-SearchBot,
  ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User,
  Google-Extended, Applebot-Extended, …) avec les mêmes chemins privés que `*` : un robot ne
  suit que son groupe. Avec `LOUEZ_SEARCH_INDEXING=off`, tout reste interdit.
- **Sitemap** : déjà complet (accueil, catalogue, catégories non vides, produits actifs, pages
  d'information) ; inchangé.

### Ce qu'on mesure

- **Visites venues d'un assistant** : la boutique lit, à la première page de la visite, le
  référent (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com,
  chat.mistral.ai, …) ou le `utm_source` que l'assistant ajoute au lien (ChatGPT met
  `chatgpt.com` et n'envoie souvent pas de référent), et le garde pour la visite
  (`page_views.ai_assistant`, `aiAssistant` dans les métadonnées des `storefront_events`). Une
  valeur d'une liste fermée, jamais l'URL.
- **Lectures par les robots des IA** : la boutique compte les requêtes dont l'agent est celui
  d'un robot connu, par jour, robot et ressource (`page` ou `llms_txt`) dans `store_ai_crawls`.
  Un compteur seulement : ni adresse IP, ni agent complet, ni page.
- **Réservations venues d'un assistant** : une réservation compte quand l'événement
  `checkout_completed` de la boutique la nomme (`metadata.reservationId`) dans une visite dont
  les pages portent un assistant (même onglet ; une visite commencée la veille compte encore).
  Hors réservations test, hors événements sans réservation (antérieurs à ce champ), une seule
  fois par réservation. Elle dit que le client est venu par un assistant, pas que l'assistant
  l'a décidé ; rien n'est inventé pour les visites sans référent.
- **PostHog** : `visibility_ai_viewed` et `visibility_ai_fix_opened`
  (`docs/analytics/visibility.md`).
- **Correctif lié** : la page produit envoyait son slug comme `productId` ; `/api/track` le
  refusait (400) et aucune vue de page produit n'était comptée. Elle envoie l'id.

### Où le loueur le trouve

Revue de Téo (18 novembre 2026) : une fois la carte d'accueil fermée, plus rien ne menait au
guide. Désormais :

- **Barre latérale, toujours** : « Se faire connaître » (sous « Produits »), avec deux entrées,
  « Premiers clients » (`/dashboard/visibility`, les trois gestes) et « Être trouvé par les IA »
  (`/dashboard/visibility/ai`). La page IA s'ouvre aussi avant la mise en ligne : compléter ses
  informations sert dès ce moment ; le lien vers `llms.txt` n'y paraît qu'une fois en ligne.
- **Analyses → Assistants IA** (`/dashboard/analytics/ai`), à côté de Ventes et Trafic, avec le
  même filtre de période : visites venues des assistants (et tendance contre la période
  d'avant), leur part dans toutes les visites, réservations passées pendant ces visites,
  lectures des robots (dont `llms.txt`), courbe visites/réservations, tableau par assistant, et
  « Comment on compte » replié (les limites ci-dessous). Procédure `visibility.getAiTraffic`.
- **Résumé sur « Se faire connaître »** : une carte « Être trouvé par les IA » (x sur 4 prêts,
  visites, réservations et lectures sur 28 jours, boutons vers la page IA et vers Analyses). La
  fermer la **replie** sur son titre, sans jamais la cacher ; le choix reste sur le navigateur
  (`localStorage`).

### Ce qui manque au loueur

Quatre points, sur la page « Être trouvé par les IA », chacun avec un bouton vers la page qui le règle :
description de la boutique (au moins 40 caractères avec l'accroche, Boutique en ligne →
Identité), adresse (Boutique en ligne → Contact), horaires d'ouverture (au moins un jour ouvert,
Réglages → Horaires), produits actifs avec photo et prix (« 3 produits sur 4 », Produits). Pas
de carte de plus sur l'accueil : l'accueil ne montre qu'une prochaine étape.

### Droit d'usage

`canUseAiVisibility(store)` (`apps/web/lib/ai-visibility/entitlement.ts`) décide seule, et
répond oui pour toutes les boutiques. L'API la consulte par `ApiPorts.aiVisibility` (procédure
`visibility.getAi` et `visibility.getAiTraffic`, refus `AI_VISIBILITY_NOT_INCLUDED`), la
boutique pour `llms.txt`, les pages du dashboard pour leurs vues (sans le droit : un message à
la place, l'entrée de la barre latérale reste). Pour la lier à une offre ou à une option payante, seule cette fonction
change (par exemple un drapeau `aiVisibility` dans `PlanFeatures`, lu par `getStorePlan`).
Restent hors du droit, exprès : le JSON-LD, les titres, le sitemap et le robots.txt de toutes
les boutiques (le référencement de base), et le comptage des visites et lectures, pour qu'une
boutique qui prend l'option voie son passé.

### Décisions

| Décision                                                        | Pourquoi                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `llms.txt` dans la langue de la boutique                        | C'est la langue que lisent déjà les robots ; un assistant traduit sans peine                         |
| Tous les tarifs de la grille, promotion comprise                | Un assistant répond « combien pour une semaine ? » ; le fichier dit ce que la page affiche           |
| Lien vers la page produit, pas de disponibilité dans le fichier | La disponibilité dépend des dates ; la page la calcule, un fichier en cache la tromperait            |
| Compter les robots en base, pas dans PostHog                    | Un événement par requête de robot coûterait cher et n'apprend rien de plus qu'un compteur journalier |
| Pas de score chiffré                                            | Comme pour la phase 1 : quatre faits vérifiables, pas une note sans mesure derrière                  |
| Section dans « Se faire connaître », pas de carte d'accueil     | L'accueil montre une seule prochaine étape (PR « prochaine étape »)                                  |

### Ce qu'on ne sait pas

- **Les assistants lisent-ils `llms.txt` ?** Aucun éditeur ne s'est engagé publiquement à le lire
  pour répondre ; le format est une proposition. Le compteur `llms_txt` de `store_ai_crawls`
  le dira boutique par boutique. Le JSON-LD, les pages et le sitemap restent la base.
- **Le référent est incomplet** : certaines applications d'assistant n'envoient ni référent ni
  `utm_source` ; ces visites comptent comme directes. Les chiffres sont un minimum.
- **Agent déclaré** : un robot peut se faire passer pour un autre ; le compteur ne vérifie pas
  les adresses IP des éditeurs.

## Hors périmètre

- Toute modification de reeent (dépôt Synapsr/Louez-Marketplace).
- Publicité payante, services tiers payants, nouveaux secrets.
- Envoi de messages par Louez au nom du loueur (pas de campagne SMS/e-mail à ses contacts,
  pas d'import de contacts).
- Générateur de contenu par IA pour les textes, et texte modifiable dans la fenêtre (le loueur
  le modifie dans WhatsApp s'il le veut).
- Un compteur « envoyé à N personnes » : déclaratif et invérifiable ; les visites `via`
  mesurent la portée réelle.
- Score SEO chiffré : un score de « visibilité » sans mesure réelle de visites serait un faux
  indicateur. On montre des actions faites, puis des visites réelles (phase 2).
- Les commissions aux partenaires locaux (campings, hôtels) : une spec à part,
  [liens-partenaires.md](liens-partenaires.md), troisième entrée de « Se faire connaître ».

## Événements à mesurer

Base : propriétés `analytics_area: core_product`, `analytics_version: 1`,
`feature: visibility`, `surface: dashboard`, `store_id` et le groupe PostHog `store`. Aucune
donnée personnelle, aucun texte saisi. Détail dans `docs/analytics/visibility.md`.

| Événement                   | Quand                                                         | Propriétés propres                                                        |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `visibility_viewed`         | La page ou la carte d'accueil est vue (une fois)              | `placement` (`page`, `home_card`), `done_count`, `skipped_count`          |
| `visibility_share_used`     | Le loueur ouvre un canal, copie un lien, enregistre l'affiche | `placement`, `channel` (= la valeur `via`), `target` (`store`, `product`) |
| `visibility_step_completed` | Il change le statut d'une étape                               | `step`, `status` (`done`, `skipped`, `todo`)                              |

La source de vérité de la mesure est en base : `store_visibility_steps` et
`page_views.source`, insensibles aux bloqueurs de pub.

**Définitions, fixées avant la sortie** :

- _boutique éligible_ : en ligne avec un produit actif ; l'horloge démarre à cette date ;
- _réservation réelle_ : créée sur la boutique en ligne (pas dans le dashboard), hors
  réservation test, hors annulée avant confirmation ;
- fenêtres d'observation communes : J+7 et J+28 après l'éligibilité.

**Lecture principale** : parmi les boutiques éligibles, part qui reçoit au moins une visite
`via` (le kit a servi), et part dont la première réservation réelle a une session `via`
(le kit a amené le client), à J+7 et J+28.

**Lectures secondaires** : part des éligibles qui décident au moins une étape ; délai jusqu'à
la première réservation réelle, avant / après la sortie, à cohorte d'éligibilité comparable.

Limites dites à chaque lecture : pas d'A/B possible au volume actuel ; auto-sélection (les
loueurs motivés font plus d'étapes) ; saison (novembre est creux pour les vélos et kayaks, haut
pour la réception) ; une réservation `via` peut venir d'un client habituel qui aurait réservé
par téléphone : elle active Louez sans prouver un client nouveau.

**Hors code** : suivre à la main quelques boutiques éligibles à J+7 (entretien court : qu'ont-
elles envoyé, à qui, qu'est-ce qui a bloqué) ; c'est plus rapide pour apprendre qu'une
nouvelle page.

## Risques

- **Contenu dupliqué entre boutiques** : les textes du kit sont envoyés par le loueur sur ses
  canaux, pas publiés sur la boutique, donc invisibles aux moteurs. En phase 3, un `llms.txt`
  ou des descriptions générées devront partir des données propres à chaque boutique.
- **Spam** : Louez n'envoie rien ; les liens `wa.me`, `sms:` et `mailto:` ouvrent l'application
  du loueur, qui choisit ses destinataires. Pas de liste de contacts.
- **Boutiques hors ligne ou vides** : la page explique qu'il faut d'abord mettre la boutique en
  ligne ; la carte d'accueil n'apparaît qu'en ligne avec un produit actif. Partager une boutique
  vide gâcherait la première impression.
- **Auto-hébergé** : pas de reeent, pas de PostHog ; les liens utilisent l'URL de la boutique de
  l'instance. Rien ne pointe vers louez.io.
- **Vie privée** : les événements ne portent que des codes ; `via` est une valeur d'une liste
  fermée, jamais un texte libre. La table ne garde que l'étape, son statut, la date et
  l'utilisateur, supprimés avec la boutique (l'utilisateur est effacé avec son compte).
- **Guide Google** : les libellés de Google Business Profile changent et l'option
  « Réservations » dépend de la catégorie et du pays ; le guide propose le champ « Site web »
  en repli et renvoie vers l'aide de Google.
- **Déclaratif** : « C'est fait » peut être coché sans être fait. Acceptable pour un guide ;
  les visites `via` disent ce qui a vraiment servi.
- **Lien `via` repartagé** : un client qui transfère le lien garde `via=whatsapp` ; la source
  dit le premier canal, pas le dernier. Les liens canoniques ne portent pas `via`, donc rien
  ne change pour les moteurs.

## Annexe — revues croisées

La première version de cette spec (six étapes cochées au premier usage, page + carte + fenêtre,
cinq événements, attribution en phase 2) a été soumise le 18 novembre 2026 à deux modèles, sans
accès au code, avec la même consigne : ce qui est inutile, ce qui manque, ce qui ferait venir des
clients à une petite boutique, ce qu'il faut couper de la phase 1.

### Codex (OpenAI, `codex exec`, lecture seule)

- « Être vus » reste une hypothèse : la chute peut venir d'un catalogue incomplet, d'un parcours
  de réservation confus sur mobile, ou de clients qui préfèrent téléphoner.
- Six étapes récompensent l'exécution d'une checklist ; reeent sans demande locale ne crée pas
  d'audience ; le code HTML finit chez le prestataire ; `llms.txt` et le SEO n'apportent rien
  la première semaine.
- Distinguer « nouveau client » et « client habituel qui réserve en ligne ».
- Le plus efficace : contacter personnellement des clients avec une offre précise (un produit,
  une date), puis récupérer la demande existante (site, fiche Google), puis des prescripteurs
  locaux ; le QR seul ne crée pas de demande.
- Phase 1 : partage amélioré, guide Google court, affiche simple ; « prochaine action » plutôt
  que « 2/6 » ; « non applicable » distinct de « fait » ; ne jamais cocher après une copie ;
  liens marqués par canal dès maintenant ; suivi manuel de quelques boutiques à J+7.
- Mesure : copie ≠ envoi ; fixer le départ à l'éligibilité et une fenêtre commune ; exclure
  tests et propriétaire. L'API Business Profile ne gère pas les liens locaux.

### Grok (xAI, sans outils ni web)

- « La spec outille le loueur, elle ne le fait pas distribuer. » Garder trois actions :
  envoyer à des gens nommés, l'affiche, le lien sur Google.
- Couper bios, HTML, reeent, le texte modifiable et trois événements sur cinq ; le coût réel est
  la traduction.
- Manque : un lien vers un produit plutôt que l'accueil ; les groupes Facebook locaux ; le
  champ « Site web » de Google comme chemin principal (beaucoup de catégories de location n'ont
  pas « Réservations ») ; l'affiche en PNG que le téléphone enregistre, `window.print` ne sert
  à rien sur mobile.
- Poser le marquage des liens dès la phase 1, sinon les liens partis seront invisibles ; ne
  compléter une étape que sur déclaration.
- Mesure : avant/après mélange les saisons ; lire une seule chose, la part des premières
  réservations réelles qui portent la source du kit.

### Ce qui a changé

| Retenu                                                                                         | Source      |
| ---------------------------------------------------------------------------------------------- | ----------- |
| Trois étapes (contacts, affiche, Google) au lieu de six                                        | les deux    |
| Plus de coche au premier usage : « C'est fait » ou « Pas pour moi », trois états               | les deux    |
| Liens marqués `?via=` et `page_views.source` en phase 1, visites par source sur la page        | les deux    |
| Carte d'accueil : la prochaine action, pas un score                                            | Codex       |
| Partage d'un produit précis, pas seulement de l'accueil                                        | Codex, Grok |
| Facebook dans les canaux (groupes locaux)                                                      | Grok        |
| Affiche en PNG plutôt qu'une page à imprimer                                                   | Grok        |
| Google : « Site web » d'abord, « Réservations » si proposé                                     | Grok        |
| Définitions (éligibilité, réservation réelle, J+7/J+28), limites de saison, lecture principale | les deux    |
| Phase 3 : pas d'intégration API Google (liens locaux non gérés par l'API)                      | Codex       |
| Suivi manuel de quelques boutiques à J+7                                                       | Codex       |
| Trois événements PostHog au lieu de cinq                                                       | Grok        |
| reeent et widget : simples liens « Autres canaux », plus des étapes                            | les deux    |
| Texte modifiable retiré                                                                        | Grok        |

| Écarté                                      | Pourquoi                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Textes dans deux ou trois langues seulement | Le dashboard sert 13 langues et ses catalogues sont validés contre l'anglais ; des textes courts gardent le coût bas |
| Compteur « envoyé à N personnes »           | Déclaratif et invérifiable ; les visites `via` mesurent la portée                                                    |
| Retirer `visibility_viewed`                 | Sans exposition, pas de dénominateur pour la carte d'accueil                                                         |
| Retirer la table au profit de PostHog       | La table est la mesure insensible aux bloqueurs, et le dashboard en a besoin pour l'état des étapes                  |
| Couper reeent entièrement                   | Lien gratuit vers un canal existant ; il reste visible sans peser sur la liste                                       |
| Préflight « réserver en 60 s » à construire | La réservation test (#211) le fait déjà ; la carte vient après elle                                                  |
