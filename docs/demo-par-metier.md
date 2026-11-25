# Démo par métier

Un loueur qui découvre Louez sur la page « location de ski » du site clique sur un
bouton et se retrouve, sans compte, sur la boutique en ligne d'un loueur de son métier.
Il y réserve comme le ferait son client, puis voit la même réservation arriver côté
loueur : matériel, acompte, caution, contrat. Derrière, un catalogue crédible, des
clients et des réservations inventés, un tableau de bord vivant. Le but : la démo la
plus parlante en 60 à 90 secondes.

Trois métiers pour commencer : **ski** (`/demo/ski`), **vélo** (`/demo/velo`, le
catalogue « Ar Mor Location » du seed de démo) et **événementiel**
(`/demo/evenementiel`).

## Le parcours

1. `/demo/<métier>` affiche le nom de la boutique et une fine barre de progression.
   Un petit script dans le HTML appelle aussitôt `POST /api/demo/start`, sans attendre
   les scripts de la page, et part vers la **boutique en ligne** dès la réponse. Un
   robot qui suit le lien n'ouvre rien : `robots.txt` de l'app lui interdit `/demo`, et
   rien ne s'ouvre sans script.
2. Le serveur prend une boutique du **pool** du métier (une mise à jour d'une ligne),
   ou, si le pool est vide, en écrit une pour ce visiteur (`lib/demo/seed-demo-store.ts`,
   quelques dixièmes de seconde). Il connecte le visiteur au compte propriétaire jetable
   de la boutique (`visiteur-…@demo.example`) : le tableau de bord est prêt, un lien plus
   loin.
3. Sur la boutique, une barre d'une ligne (boutique de démonstration, paiement simulé,
   « Voir côté loueur », « Créer ma boutique gratuite ») et la carte « Choisissez votre
   cas » : deux scénarios du métier (ci-dessous), chacun avec la photo de son produit.
   En choisir un met ses dates dans le panier et ouvre son produit ; la carte liste alors
   les deux ou trois gestes qui restent.
4. Le visiteur réserve sous une identité inventée, déjà remplie, et le paiement est
   simulé (la page de paiement simulé des réservations test). Sa page de réservation
   porte « Voir côté loueur », qui ouvre cette réservation dans le tableau de bord. Le
   « Voir côté loueur » de la barre et de la carte mène aussi à la dernière réservation
   du visiteur (`/demo/rental-side`), pas à la liste : une boutique de démo en contient
   des dizaines.
5. Le tableau de bord garde, au-dessus de tout, sa barre d'une ligne et le guide « À
   essayer » (état des lieux d'un départ, caution d'une location en cours).
   « Créer ma boutique gratuite » (`/demo/signup`) compte le clic, déconnecte le compte
   de démo et mène à l'inscription. La boutique de démo est supprimée, avec son compte,
   24 heures après sa création.

## Les scénarios

Deux par métier, au plus : d'abord le cas que seul ce métier a, puis un cas simple, en
trois clics. Le cas du métier passe devant : c'est lui qui montre ce que d'autres outils
ne font pas (au ski, ce que le client renseigne pour chaque skieur).
Les données sont dans `lib/demo/verticals/<métier>.ts` (`scenarios`), le guide dans
`components/storefront/shell/demo-storefront-guide.tsx`.

| Métier       | Cas du métier                                                                                                                   | Cas simple                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Ski          | deux Packs Sensation : pour chaque skieur, prénom, taille, poids, pointure et niveau, demandés au paiement                      | un Pack Découverte adulte, six jours        |
| Vélo         | un VAE trekking : la taille de cadre choisie d'après le guide des tailles de la fiche, un casque proposé, la taille du cycliste | un vélo de ville, une journée               |
| Événementiel | un mariage : tente de réception, tables rondes et chaises dans un panier, livré à l'adresse du lieu                             | un barnum 3 × 3, le week-end, retrait dépôt |

Tout est du produit réel, rien n'est simulé hors paiement :

- **Mesures par skieur, taille du cycliste** : les champs personnalisés « par article »
  (`customer_field_definitions`, portée `item`), exactement ceux des modèles « Ski et
  montagne » et « Vélos » de Louez, demandés à l'étape « Détails » du paiement pour les
  produits ciblés. Ils arrivent sur la réservation côté loueur et sur le contrat.
- **Taille de cadre** : l'axe de variante « Taille » du produit, choisi sur la fiche.
- **Casque** : l'accessoire proposé après « Ajouter au panier ».
- **Livraison** : la livraison à l'adresse de Louez, avec ses frais au kilomètre. Sur
  une boutique de démo, les adresses proposées sont une courte liste inventée près de la
  boutique et la distance se mesure à vol d'oiseau (`lib/demo/demo-addresses.ts`,
  `lib/reservations/resolve-delivery.ts`) : aucun appel Google Places ni Routes.

**Le plus parlant : le cas du métier au ski.** Un loueur de ski reconnaît tout de suite
sa vraie difficulté du samedi matin : la file au comptoir, où l'on mesure, pèse et règle
chaque skieur. Voir son client donner taille, poids, pointure et niveau pour chacun au
moment de réserver, puis retrouver ces mesures sur la réservation et le contrat, c'est
le « ça correspond vraiment à mon flow » en moins d'une minute. Le cas simple, lui,
montre que la boutique se réserve seule ; il est utile, mais n'importe quel outil le
fait.

## Décisions

### Une boutique par visiteur, supprimée au bout de 24 heures

Trois modèles étaient possibles :

| Modèle                                          | Pour                                     | Contre                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Une boutique partagée en lecture seule          | Rien à créer, rien à nettoyer            | On ne peut rien essayer : ni réserver, ni faire un état des lieux, ni rendre une caution. Toutes les écritures à bloquer une à une |
| Une boutique partagée remise à zéro chaque nuit | Simple                                   | Les visiteurs se voient et se gênent dans la journée ; un visiteur peut tout casser pour les autres jusqu'à la nuit                |
| **Une boutique par visiteur, éphémère**         | Tout s'essaie, personne ne gêne personne | Une boutique à créer à chaque visite, à nettoyer ensuite, à limiter contre l'abus                                                  |

Retenu : **une boutique par visiteur**. Le visiteur peut tout faire, et ce qu'il fait
ne touche que lui. Le coût est maîtrisé : 40 démos par adresse IP et par heure (assez
pour une équipe derrière un même accès internet), 2 000 boutiques de démo actives au
plus (`lib/demo/constants.ts`), et la purge toutes les dix minutes des boutiques
expirées par la suppression de compte existante (`lib/demo/cleanup.ts`), qui connaît
toutes les tables d'une boutique. Revenir sur `/demo/ski` pendant 24 heures ramène à la
même boutique.

### Un pool de boutiques prêtes, par métier

Chaque métier garde 6 boutiques prêtes (`lib/demo/demo-pool.ts`) : une boutique de démo
complète, avec son compte propriétaire et son identifiant de connexion, que personne ne
voit (`stores.demo_claimed_at` vide). Le clic d'un visiteur en réclame une
(`claimPooledDemoStore`, `FOR UPDATE SKIP LOCKED` : deux visiteurs n'ont jamais la même)
et lui donne 24 heures. Une boutique du pool vit 45 minutes et n'est plus réclamée après
30 : son « aujourd'hui » (départs et retour du jour) reste à venir. Le pool se remplit
quelques secondes après chaque réclamation, sur l'intention d'ouvrir une démo
(`/api/demo/warm`) et chaque minute par le cron ; les boutiques du pool expirées sont
supprimées par la même purge.

Pool vide (une rafale de clics) : la boutique est écrite pour le visiteur, trois à la
fois par processus, les autres attendent leur tour (20 secondes au plus, puis « réessayez
dans quelques secondes », que l'écran fait seul). Jamais d'erreur 500 : une rafale ralentit,
elle ne casse pas.

### Préchauffer sur l'intention, pas à chaque visite

Créer une boutique à chaque affichage d'une page du site serait du gaspillage (la plupart
des visiteurs ne cliquent pas) et Googlebot exécute le JavaScript. Le site appelle plutôt
`POST /api/demo/warm?vertical=<métier>` quand un visiteur pointe, sélectionne ou touche un
bouton de démo. L'appel ne fait que compléter le pool jusqu'à sa taille : il ne crée rien
pour personne, mille appels ne font pas plus de boutiques qu'un seul, et un robot ne
survole rien. Seuls l'app et les origines du site marketing sont écoutées.

Pour les pages ski, vélo et événementiel du site (une PR du dépôt du site) :

```html
<a href="https://app.louez.io/demo/ski?ref_cta=pro_ski_hero" data-louez-demo="ski">
  Essayer la démo
</a>
<script>
  // Prépare une boutique de démo dès que le visiteur montre son intention de cliquer.
  (() => {
    const warmed = new Set();
    const warm = (event) => {
      const link = event.target.closest?.("[data-louez-demo]");
      const vertical = link?.dataset.louezDemo;
      if (!vertical || warmed.has(vertical)) return;
      warmed.add(vertical);
      navigator.sendBeacon(`https://app.louez.io/api/demo/warm?vertical=${vertical}`);
      // Le document de la page démo, mis en cache pour le clic.
      const prefetch = document.createElement("link");
      prefetch.rel = "prefetch";
      prefetch.href = link.href;
      document.head.append(prefetch);
    };
    for (const type of ["pointerenter", "focusin", "touchstart"]) {
      document.addEventListener(type, warm, { capture: true, passive: true });
    }
  })();
</script>
```

### Le seed est un générateur, pas un clone

Chaque métier est une donnée (`lib/demo/verticals/*.ts`) : identité de la boutique,
catégories, produits avec paliers, saisons, cautions et unités suivies, paniers types,
saisonnalité mensuelle. Un seul générateur en tire une boutique datée par rapport à
aujourd'hui : un historique sur la dernière saison, des réservations à venir, et un
« aujourd'hui » avec des locations en cours, des départs et un retour encore à venir
dans la journée, et une demande à traiter. Ajouter un métier, c'est ajouter un fichier
de données.

Les paiements de démo sont tous enregistrés « à la main » (carte au comptoir, espèces,
virement, chèque de caution) : aucune ligne ne porte d'identifiant Stripe, donc aucun
bouton du tableau de bord ne peut appeler Stripe.

Les photos des catalogues ski et événementiel sont générées avec Gemini 3 Pro Image,
sans marque ni texte. Elles sont servies depuis `apps/web/public/demo/` : 1024 × 1024
pour un produit, 1536 × 640 pour une bannière, en WebP. Le vélo reprend les photos déjà
hébergées du seed « Ar Mor Location ». Pour qu'un nouveau métier garde le même style,
chaque photo de produit part de la même consigne, où seul le sujet change :

> Professional e-commerce product photograph for a rental shop catalog. _Sujet, décrit
> comme la fiche produit (ce qui est inclus, couleurs, pas d'accessoire vendu à part)._
> Plain light warm-grey seamless background filling the whole frame edge to edge, no
> studio lights, softboxes or equipment visible, soft natural shadow, even softbox
> lighting, sharp focus, photorealistic, realistic proportions, physically correct.
> Generic unbranded equipment: absolutely no logos, no brand names, no text, no letters,
> no numbers anywhere.

Une tente ou un barnum se photographie dehors, sur une pelouse. Une bannière est un
panorama 21:9, sans visage reconnaissable ni texte.

### Le visiteur ne laisse aucune coordonnée réelle

Le checkout d'une boutique de démo s'ouvre rempli avec une identité inventée, et le
serveur réserve avec son e-mail et son téléphone quoi que le formulaire envoie
(`lib/demo/demo-checkout.ts`). Tous les e-mails d'une boutique de démo sont dans le
domaine réservé `.example` (RFC 2606) et tous les téléphones dans les plages de
fiction de l'ARCEP.

## Garde-fous

Une boutique de démo est marquée par `stores.demo_vertical` (migration 0117). Tout ce
qui la traite à part passe par les helpers de `packages/db/src/demo-stores.ts`
(`excludeDemoStores`, `isDemoStore`, `notDemoStoreId`) : `rg "DemoStore|demoVertical"`
trouve tout.

| Rien ne sort          | Où                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mails               | les dispatchers de notifications ; l'outbox (`lib/demo/outbox-policy.ts`) ; le client e-mail de l'app, qui n'envoie rien dans une requête de démo ; `@louez/email`, qui n'envoie jamais à `.example` ni `.invalid`                            |
| SMS                   | `deliverSms`                                                                                                                                                                                                                                  |
| Push, Discord         | les dispatchers ; les notifications fondateurs (`lib/discord/platform-notifications.ts`)                                                                                                                                                      |
| Stripe                | aucune ligne Stripe dans le seed ; paiement simulé ; onboarding, tableau Stripe, remboursement en ligne, abonnement, carte, recharges SMS et crédits IA refusés                                                                               |
| IA payante, téléphone | assistant du tableau de bord masqué et route refusée ; conseiller de la boutique, retouche et détourage d'image refusés ; numéro de téléphone et réglages voix refusés ; autocomplétion d'adresse (Google Places) coupée côté tableau de bord |
| Adresses, itinéraires | sur la boutique, adresses inventées et distance à vol d'oiseau, au paiement comme sur le serveur (`lib/demo/demo-addresses.ts`, `resolve-delivery`)                                                                                           |
| Intégrations          | Tulip, Google Agenda, avis Google refusés                                                                                                                                                                                                     |

| Exclu de             | Où                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moteurs de recherche | `noindex` sur chaque page, `robots.txt` qui refuse tout, sitemap vide                                                                                                                           |
| llms.txt             | 404                                                                                                                                                                                             |
| Marketplace reeent   | flux catalogue, publication par défaut, publication par le propriétaire, réservation marketplace                                                                                                |
| KPIs et PostHog      | événements métier serveur ignorés ; aucun PostHog, OpenReplay, FromHello, Gleap ni Klibon côté navigateur ; boutiques absentes du sélecteur des admins plateforme                               |
| Facturation          | aucune date de facturation ni effet de frais ; la file de synchronisation écarte la boutique ; la porte des réservations reste ouverte ; le balayage, le heartbeat et les manifestes l'ignorent |

| Actions refusées                                                                             | Où                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Inviter, retirer un membre, lien d'invitation                                                | `packages/api/src/platform/demo-store-policy.ts` |
| Créer une autre boutique, changer l'adresse de la boutique                                   | idem                                             |
| Clés API, connexions d'agent ; tout appel par clé ou jeton                                   | idem (seule la session du visiteur est acceptée) |
| Actions serveur héritées (Stripe, abonnement, recharges, voix, webhook Discord, avis Google) | `lib/demo/refuse-on-demo-store.ts`               |

## Analytics

Trois événements PostHog, envoyés par le serveur, avec `vertical` (`ski`, `velo`,
`evenementiel`) et `demo_visitor_id` (l'id de la boutique de démo) :

| Événement             | Quand                                                                       | Propriétés                            |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------- |
| `demo_started`        | la boutique est créée                                                       | attribution du site (`ref_cta`, UTM…) |
| `demo_step`           | un pas du guide, la boutique ouverte, une réservation faite sur la boutique | `step`, `guide_step`                  |
| `demo_signup_clicked` | « Créer ma boutique gratuite »                                              | `from` : `dashboard` ou `storefront`  |

L'événement est compté sur l'id PostHog du visiteur quand le site louez.io l'a laissé
dans son cookie, sinon sur `demo:<id de la boutique>`. Aucun profil de personne n'est
écrit (`$process_person_profile: false`).

## Exploitation

- **Désactivé en auto-hébergement** (`LOUEZ_MODE=standalone`) : `/demo` répond 404, et
  une boutique de démo ne peut jamais devenir la boutique unique d'une instance.
- **`STOREFRONT_URL_TEMPLATE`** : pour une preview dont les boutiques sont servies
  derrière un autre schéma d'hôte (un tunnel), où ouvrir une boutique dans les URL que
  le serveur construit, `{slug}` pour son slug. Vide en production.
- **Purge** : la tâche cron `demo-stores-purge`, toutes les dix minutes.
- **Pool** : la tâche cron `demo-pools-fill`, chaque minute, après la réponse du cron.

### Relancer une preview

Une preview tourne sur un build de production, pas sur `next dev` : derrière un tunnel,
les chunks de dev ne sont pas hachés et un cache les garde plusieurs heures. Il faut donc
rebuilder après chaque changement. `PREVIEW_ENV` désigne le fichier de variables de la
preview. Il pointe `DATABASE_URL` vers une base MySQL jetable (jamais la pré-prod) et
fixe `STOREFRONT_URL_TEMPLATE`. Il ne se commite pas.

Le serveur tourne sous launchd, comme la base jetable. Un serveur lancé depuis un
terminal ou un agent, même détaché (`nohup`, `setsid`, `--detach`), s'arrête avec la
session qui l'a lancé. Un agent launchd (`~/Library/LaunchAgents/<label>.plist`) le garde
en vie, et `KeepAlive` le relance s'il tombe. Son programme :

```sh
localify dev web --project rental-core-preview --env feat-demo-par-metier --replace -- \
  /bin/sh -c 'set -a; . "$HOME/<chemin>/preview.env"; set +a; exec ./node_modules/.bin/next start --hostname 127.0.0.1 --port "${PORT:-56282}"'
```

Son `WorkingDirectory` est `apps/web` du worktree. Son `PATH` doit contenir `node` et
`localify`.

```sh
export PREVIEW_ENV=/chemin/vers/preview.env
cd apps/web

# Rebuild (environ 5 minutes), puis relance
launchctl bootout gui/$(id -u)/<label>
(set -a && . "$PREVIEW_ENV" && set +a && NODE_ENV=production pnpm run build)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist

# Relance sans rebuild
launchctl kickstart -k gui/$(id -u)/<label>
```

- `localify dev … --env feat-demo-par-metier` garde le domaine local de la preview. L'URL
  publique (Localify Cloud) et son mot de passe ne changent donc pas.
- L'avertissement « next start does not work with output: standalone » est sans effet.
- Pour vérifier la base utilisée :
  `lsof -nP -a -p <PID de next-server> -iTCP -sTCP:ESTABLISHED`. Il ne doit montrer que
  l'hôte et le port de la base jetable.
- Pour arrêter la preview : `launchctl bootout gui/$(id -u)/<label>`. Sinon,
  `KeepAlive` la relance.

## Limites connues

- **Packs** : Louez n'a pas de lot composé d'articles de stock. Les packs ski sont des
  produits à part entière, avec leur propre stock ; la longueur des skis et la pointure
  se choisissent au comptoir. Réserver un pack ne réserve donc pas une paire de skis
  suivie à l'unité.
- **Stock par site** : une boutique de démo n'a qu'un point de retrait ; le stock par
  site n'est pas montré.
- **Forfait saison** : un produit à prix fixe (`pricing_kind = fixed`), un seul prix
  quelles que soient les dates. Pas de date de fin de saison imposée.
- **Caution** : enregistrée à la main (chèque, carte au comptoir). L'empreinte
  bancaire Stripe ne se montre pas, faute de Stripe.
- **Langues** : l'interface de la démo est en français et en anglais ; les autres
  langues reprennent l'anglais. Les catalogues et le guide sont en français.
- **Liens côté navigateur en preview** : avec `STOREFRONT_URL_TEMPLATE`, les liens
  construits par le serveur suivent le gabarit, pas ceux que le navigateur construit
  (le lien de la boutique dans la barre latérale).
- **Réglage des fixations (DIN)** : Louez ne le calcule pas. Le loueur lit taille, poids
  et niveau sur la réservation et le contrat, et note le réglage à l'état des lieux de
  départ (le champ « Réglage des fixations (DIN) »).
- **Quantité du scénario** : le guide met les dates dans le panier, pas la quantité ; le
  visiteur passe à deux packs lui-même.
- **Deux cyclistes de tailles différentes** : une ligne de panier par taille de cadre.
- **Unité attribuée** : la boutique réserve un pack ou une taille, pas une paire précise ;
  le loueur attribue les unités dans le tableau de bord.
- **Connexion à l'espace client de la boutique** : le code de connexion part par
  e-mail, donc n'arrive pas. Après une réservation, le visiteur arrive déjà connecté à
  sa réservation ; ensuite, « Mes locations » lui demande un code qu'il ne recevra pas.
- **Un mail « envoyé »** : dans une boutique de démo, « Envoyer un e-mail » et les
  liens de paiement répondent comme si l'envoi avait eu lieu ; rien ne part.

## Prochaines étapes

1. Les boutons du site : « Essayer la démo » sur `/fr/pro/location-ski`, la page vélo et
   la page événementiel, vers `/demo/ski`, `/demo/velo`, `/demo/evenementiel`, avec leur
   `ref_cta` (le cookie `louez_attribution` suit jusqu'à `demo_started`).
2. D'autres métiers : un fichier de données par métier (kayak et paddle, matériel de
   chantier, photo et vidéo, mobilité).
3. Mesurer le tunnel `demo_started` → `demo_step` → `demo_signup_clicked` →
   `account_created` par métier, puis décider des pas du guide.
4. Les packs comme lot d'articles suivis, quand le catalogue saura les composer.

## Related

- [docs/domain/reservation-invariants.md](domain/reservation-invariants.md) — les
  réservations test, dont la démo reprend le paiement simulé
- [docs/landing-demos.md](landing-demos.md) — les scènes animées de la page d'accueil,
  une autre démo, sans base de données
- [docs/analytics](analytics) — les autres événements produit
