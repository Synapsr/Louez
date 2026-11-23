# Démo par métier

Un loueur qui découvre Louez sur la page « location de ski » du site clique sur un
bouton et se retrouve, sans compte, dans une boutique d'exemple de son métier : un
catalogue crédible, des clients et des réservations inventés, un tableau de bord vivant
et une boutique en ligne où il réserve comme un client. Il voit en deux minutes si
Louez colle à sa journée.

Trois métiers pour commencer : **ski** (`/demo/ski`), **vélo** (`/demo/velo`, le
catalogue « Ar Mor Location » du seed de démo) et **événementiel**
(`/demo/evenementiel`).

## Le parcours

1. `/demo/<métier>` affiche le nom de la boutique et une fine barre de progression.
   Un petit script dans le HTML appelle aussitôt `POST /api/demo/start`, sans attendre
   les scripts de la page, et part vers `/dashboard` dès la réponse (fondu entre les
   deux pages). Un robot qui suit le lien n'ouvre rien : `robots.txt` de l'app lui
   interdit `/demo`, et rien ne s'ouvre sans script.
2. Le serveur prend une boutique du **pool** du métier (une mise à jour d'une ligne),
   ou, si le pool est vide, en écrit une pour ce visiteur (`lib/demo/seed-demo-store.ts`,
   quelques dixièmes de seconde). Il connecte le visiteur au compte propriétaire jetable
   de la boutique (`visiteur-…@demo.example`).
3. Le tableau de bord porte, au-dessus de tout, une barre « Démo » d'une ligne (boutique
   de démonstration, données fictives, heures restantes, « Voir la boutique », « Créer
   ma boutique gratuite ») et le guide « À essayer » : réserver sur la
   boutique, voir la réservation arriver, faire l'état des lieux d'un départ, gérer la
   caution d'une location en cours.
4. Sur la boutique, le paiement est simulé (la page de paiement simulé des
   réservations test) et le visiteur réserve sous une identité inventée, déjà remplie.
5. « Créer ma boutique gratuite » (`/demo/signup`) compte le clic, déconnecte le
   compte de démo et mène à l'inscription. La boutique de démo est supprimée, avec son
   compte, 24 heures après sa création.

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

Les photos des catalogues ski et événementiel sont générées (FLUX Schnell), sans
marque ni texte, et servies depuis `apps/web/public/demo/`. Le vélo reprend les photos
déjà hébergées du seed « Ar Mor Location ».

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
- **Autocomplétion d'adresse sur la boutique** : non coupée (le checkout de démo est
  déjà rempli, l'appel reste rare).
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
