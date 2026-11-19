# Liens partenaires — les recommandations locales qui rapportent

Statut : spec ; phases 1 et 2 sur une branche, pas fusionnées (novembre 2026). Propriétaire : Téo.
Origine : note « Liens partenaires » de Téo (8 novembre 2026).

## Problème

Une boutique de location vit du bouche-à-oreille local : le camping envoie ses clients chez le
loueur de vélos, l'office de tourisme recommande le kayak, l'organisatrice de mariages conseille
le loueur de vaisselle. Ces recommandations existent déjà, mais :

- **le partenaire n'en tire rien de mesurable**, donc il recommande quand il y pense ;
- **la boutique ne sait pas qui lui envoie des clients**, donc elle ne peut ni remercier ni
  choisir ses partenaires ;
- quand une boutique veut quand même reverser une commission, elle tient un carnet ou un
  tableur, sur la parole du client (« c'est le camping qui m'envoie »).

Les logiciels de réservation touristique ont presque tous une fonction d'affiliation ou
d'agents ; les logiciels de location que nous avons regardés n'en ont pas, ou renvoient vers un
outil tiers payant (voir « Ce que font les autres »).

## L'idée

Chaque boutique donne **un lien à chacun de ses partenaires locaux**. Quand un client réserve
par ce lien (ou donne son code), Louez **attribue la réservation** et
**calcule la commission** que la boutique a fixée (par exemple 10 % de la location). En fin de
mois, la boutique voit ce qu'elle doit à chaque partenaire, **le paie elle-même**, et le marque
payé.

**Aucun argent ne passe par Louez** : pas de reversement, pas d'encaissement pour le compte
d'autrui. Louez suit et calcule ; la boutique paie. (Les obligations propres à la boutique et
au partenaire, comme une facture de commission, restent les leurs.)

Fonction **gratuite pour toutes les boutiques**, comme le reste de « Se faire connaître » :
c'est un levier d'activation (plus de réservations, donc plus de revenus à l'usage), pas une
offre payante.

## Pour qui

| Qui                                                   | Ce qu'il veut                                                                              | Ce dont il a besoin                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Le loueur** (souvent seul, sur son téléphone)       | Plus de clients via les gens qui le recommandent déjà ; les remercier sans tenir de carnet | Ajouter un partenaire en 30 secondes ; un lien et une affiche prêts ; savoir ce qu'il doit, à qui, ce mois-ci |
| **Le partenaire** (accueil d'un camping, d'un hôtel…) | Recommander sans effort, et être sûr d'être payé de ce qu'il a apporté                     | Un QR à poser au comptoir, un lien pour le mail de bienvenue ; voir où il en est, être prévenu de ses gains   |
| **Le client final** (vacancier, futur marié…)         | Réserver vite, au même prix                                                                | Rien de nouveau : la boutique, ses prix, son paiement ; un code partenaire facultatif au paiement             |

Le partenaire **n'a pas de compte Louez** : un compte serait une barrière pour quelqu'un qui
n'est pas client de Louez. Un office de tourisme public peut ne pas avoir le droit de toucher
une commission : c'est à la boutique de le savoir ; le lien et l'affiche servent quand même.

## Ce qui existe déjà

- **Parrainage entre boutiques** (`?ref=`, `proxy.ts`, `/dashboard/referrals`) : un cookie
  `louez_referral` posé côté serveur, dernier clic, 30 jours. Autre public (des boutiques qui
  recommandent Louez), récompense en crédit de facturation.
- **Canal reeent** : `?channel=marketplace` posé par le proxy dans un cookie httpOnly
  `louez_channel` de la boutique, lu au checkout côté serveur (`reservations.sales_channel`).
- **« Se faire connaître »** (PR #222/#224) : liens marqués `?via=<canal>` → `page_views.source`
  ; affiche QR imprimable (`util.poster.ts`) ; fenêtre de partage.
- **Montants d'une réservation** : `subtotal_amount` (lignes + assurance), `discount_amount`,
  `delivery_fee`, `deposit_amount`, `tulip_insurance_amount`, `currency` figée à la création.
- **Statuts** : `pending`, `quote`, `confirmed`, `ongoing`, `completed`, `cancelled`, `rejected`,
  `declined`. Une réservation test (`is_test`) n'entre dans aucun compte.
- **Les vitrines n'ont pas de bandeau de consentement aux cookies.**

## Ce que font les autres

Pages d'aide et de prix publiques des éditeurs, lues le 19 novembre 2026 (date de mise à jour
de la page entre parenthèses quand elle en a une). Le centre d'aide de Bókun était hors ligne ce
jour-là : sa ligne vient d'extraits de recherche de ses pages.

| Produit                          | Lien et attribution                                                                                                                 | Base et moment de la commission                                                                            | Annulations                                                 | Ce que voit le partenaire                                | Paiement                                                      | Sources                                                                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FareHarbor                       | Lien ou widget suivi, QR (un QR = un affilié), code promo, ou réservation faite par le partenaire. Fenêtre du cookie : non publiée  | Fixe ou %, par client, réservation ou produit ; pas de paliers. Payée « une fois la réservation terminée » | Selon l'accord ; le rapport inclut ou exclut les annulées   | Un accès et un rapport « Payable to Affiliate »          | Hors logiciel : « pas versées automatiquement »               | [méthodes](https://help.fareharbor.com/hc/en-us/articles/42957577429019), [paiements](https://help.fareharbor.com/hc/en-us/articles/42957573653019), [rapports](https://help.fareharbor.com/hc/en-us/articles/42957581849499) (2026-10-15)                                   |
| Rezdy                            | `?agentCode=CODE` + QR par e-mail ; **cookie de 6 mois** ; agent « privé » sans compte                                              | % ou prix net par tarif ; avant taxes et frais ; extras sur option                                         | Annulée dans les délais : commission annulée                | Accès gratuit en lecture seule                           | Cinq modes, dont paiement automatisé (frais)                  | [lien](https://support.rezdy.com/hc/en-us/articles/19867757481244), [agent](https://support.rezdy.com/hc/en-us/articles/19867756534428), [tarifs](https://support.rezdy.com/hc/en-us/articles/19867759012636) (2026-04-17)                                                   |
| Checkfront                       | Identifiant partenaire dans l'URL ou le widget ; attribution à la main par l'équipe                                                 | % ou fixe par produit, bonus par partenaire ; sur le total des articles                                    | Annulées exclues du rapport                                 | Accès, ses réservations, une liste de paiements          | Hors logiciel ; l'admin marque Payé/Dû ; export CSV/PDF       | [réglages](https://support.checkfront.com/hc/en-us/articles/19868502363164) (2026-02-19), [rapport](https://support.checkfront.com/hc/en-us/articles/19868504265884) (2026-02-17), [à la main](https://support.checkfront.com/hc/en-us/articles/19868678336028) (2026-05-19) |
| Bókun                            | `?trackingCode=CODE` ; « Sale Source » pour les réservations faites à la main                                                       | % obligatoire ; moment non trouvé                                                                          | Non trouvé                                                  | Rapport de commission due                                | Non trouvé                                                    | [création](https://helpdesk.bokun.io/articles/106886-how-to-create-affiliates), [URL](https://helpdesk.bokun.io/articles/106891-how-to-track-affiliate-sales-using-tracking-codes-in-urls)                                                                                   |
| TrekkSoft                        | Code agent saisi au checkout (champ code promo), peut donner une remise                                                             | % ou fixe, toujours avant taxes et frais, sur l'activité seule                                             | Non trouvé                                                  | Accès, son rapport                                       | Pas de paiement automatique                                   | [agents](https://support.trekksoft.com/creating-agent-accounts) (2024-07-18)                                                                                                                                                                                                 |
| Booqable                         | Rien d'intégré : renvoie vers **Refersion**, payant (fiche « Refersion Beta ») ; ne suit que le checkout, pas les changements après | Calculée par Refersion ; taxes à régler à l'identique des deux côtés                                       | Non suivies après le checkout                               | Dans Refersion                                           | Dans Refersion                                                | [fiche](https://booqable.com/integrations/refersion/), [aide](https://help.booqable.com/en/articles/14282511) (2026-04-30)                                                                                                                                                   |
| Twice, Rentman, Lokki            | **Rien pour les boutiques** (Twice propose des codes promo en contournement)                                                        | —                                                                                                          | —                                                           | —                                                        | —                                                             | [Twice](https://support.twicecommerce.com/en/articles/9459855-creating-and-deleting-discount-codes) (2025-09-16)                                                                                                                                                             |
| Rental Tide (location)           | `?ref={id}`, codes promo, QR                                                                                                        | Avant taxes, frais et options ; un changement de taux vaut pour les réservations futures                   | Non trouvé                                                  | Portail sur invitation, code par e-mail, clients masqués | « Record Payout » : la boutique note, l'argent passe ailleurs | [docs](https://docs.rentaltide.com/marketing/affiliate/)                                                                                                                                                                                                                     |
| Rewardful / Tolt / FirstPromoter | Cookie 60 à 90 jours, premier ou dernier clic au choix ; codes comptés sans clic                                                    | Due après un délai (Rewardful : 30 jours) ou au paiement                                                   | Remboursement : supprimée, recalculée, ou négative reportée | Portail                                                  | Le marchand paie (ou l'outil, contre frais)                   | [Rewardful](https://help.rewardful.com/en/articles/2155812), [Tolt](https://tolt.com/terms-of-service) (2026-11-04), [FirstPromoter](https://help.firstpromoter.com/en/articles/13772161) (2026-05-21)                                                                       |

Ce que nous en retenons : un seul paramètre dans le lien et un QR pour l'accueil ;
l'attribution à la main par la boutique ; la base **hors caution, livraison et options** ; le
taux **copié sur la réservation** ; la commission **due à la fin de la location** et annulée
avec elle ; un état payé/dû noté par la boutique, avec export ; une vue du partenaire **sans
données client**. Aucun outil de location ne le fait en natif.

## Le modèle retenu

Le plus simple qui tienne debout, et qui reste souple pour la boutique.

### Un partenaire

| Champ      | Pourquoi                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom        | « Camping Les Pins » : ce que la boutique, le client et le partenaire lisent                                                                                                |
| Contact    | Nom, e-mail, téléphone, facultatifs (repliés) : pour envoyer le lien et le relevé, rien d'autre                                                                             |
| Code       | Tiré du nom à la création (`camping-les-pins`, sinon `-2`…), unique dans la boutique, **jamais modifié** : une affiche imprimée doit continuer à marcher après un renommage |
| Commission | **Pourcentage** de la location (ex. 10 %) **ou montant fixe** par réservation (ex. 5 €)                                                                                     |
| Archivé    | Son lien ne crédite plus rien ; ses réservations et relevés restent                                                                                                         |

Pas de paliers, pas de commission par produit : la boutique change le taux quand elle veut, et
le changement vaut pour les réservations attribuées **après** (le taux est copié sur la
réservation au moment de l'attribution).

### Le lien et le code

`https://<boutique>/?partner=camping-les-pins` (ou n'importe quelle page de la boutique avec
`?partner=`). Lisible, imprimable, et il marche sur les liens de produit.

- **Attribution** : le proxy de la vitrine lit `?partner=` et pose un cookie httpOnly
  `louez_partner` sur le domaine de la boutique (le slug de la boutique, le code, l'heure du
  clic), sans rien demander au client : **décision de Téo du 19 novembre 2026**, en
  connaissance de la position de la CNIL (voir « Vie privée »). **Dernier lien cliqué** : un
  autre lien partenaire le remplace ; les liens `via` de la boutique ne le touchent pas.
- **Durée** : réglable par boutique (7, 14, 30, 60 ou 90 jours ; 30 par défaut). Le cookie vit
  90 jours ; la durée de la boutique est vérifiée à la réservation.
- **Code partenaire** au paiement : « Un partenaire vous a recommandé ? » (replié), pour le
  client recommandé de vive voix ou passé d'un appareil à l'autre. Un code tapé compte toujours,
  sans durée, et passe avant le lien. Le champ n'apparaît que si la boutique a des partenaires,
  et pas quand le client est déjà arrivé par un lien.
- **À la réservation** : le checkout attribue la réservation au partenaire actif de **cette**
  boutique (code tapé, sinon lien dans la durée). Un code inconnu ou archivé n'attribue rien,
  une réservation test jamais, une réservation déjà attribuée garde son partenaire. Une erreur
  d'attribution ne fait jamais échouer une réservation.
- **L'avantage client** (facultatif) : un des codes promo de la boutique, appliqué tout seul au
  paiement quand le client arrive par le lien ou tape le code. Il se voit comme un code promo ;
  il ne marche que tant que le code promo est actif.
- **La visite** : `/api/track` note le partenaire sur les pages vues (`page_views.partner_id`) :
  la boutique voit si l'affiche sert, avant la première réservation.
- **À la main** : en créant une réservation (carte « Partenaire »), ou sur la fiche d'une
  réservation, la boutique l'attribue à un partenaire, la change ou la retire.

### La commission

**Base** : le prix de la location tel que la boutique l'a fixé, remise déduite, **sans
caution, livraison ni assurance** : `subtotal − assurance − remise`. En mode « prix TTC »
c'est le TTC payé par le client ; en mode « prix HT », le HT. C'est le chiffre que le loueur
reconnaît et dit en une phrase au partenaire.

**Montant** : pourcentage × base, ou montant fixe ; arrondi à l'unité mineure de la devise ;
jamais plus que la base, jamais négatif. **Une seule règle** : la commission suit la
réservation (une modification de la réservation la change) ; ce qui ne passe pas par la
réservation (remboursement partiel, geste commercial) se règle par un **ajustement** : la
boutique saisit le montant dû et un motif, visibles sur le relevé, et peut revenir au calcul.

**États** (dérivés de la réservation, jamais saisis) :

| État    | Quand                                                                | Compté dans « à payer » |
| ------- | -------------------------------------------------------------------- | ----------------------- |
| À venir | Demande, devis ; confirmée ou en cours avant sa date de fin          | Non                     |
| Due     | Terminée, **ou** confirmée / en cours dont la date de fin est passée | Oui                     |
| Annulée | Annulée, refusée, déclinée                                           | Non                     |

« Due à la date de fin » plutôt qu'au seul statut `completed` : beaucoup de boutiques ne
clôturent pas leurs réservations, et le partenaire n'a pas à attendre ce clic.

### Le relevé mensuel

Le mois d'une réservation est **le mois de sa fin de location**, dans le fuseau de la
boutique. Pour chaque partenaire et chaque mois (les 12 derniers) :

- les réservations (numéro, dates, base, commission, état, origine, ajustement) — **jamais le
  nom, l'e-mail ou le téléphone du client** ;
- dû, payé, reste à payer, à venir, visites par son lien ;
- **« Marquer comme payé »** : la boutique note qu'elle a réglé le reste de ce mois (montant,
  date). Si une réservation du mois change ensuite, le reste à payer montre l'écart (positif
  ou négatif) ; un paiement noté par erreur s'annule ;
- **export CSV** pour la comptabilité de la boutique (cellules neutralisées contre les
  formules).

### L'espace partenaire

Un **lien secret** (`/partner/<secret>`, 43 caractères aléatoires), sans compte, que la boutique
envoie avec le lien dans un message prêt (e-mail, WhatsApp). Il ouvre l'espace du partenaire :

- **où il en est**, d'un coup d'œil : **À recevoir** (commissions dues, pas encore payées, tous
  mois confondus), **À venir** (locations réservées, pas encore terminées), **Reçu** (ce que la
  boutique a noté payé) ;
- la règle en une phrase (taux, durée du lien, avantage client s'il y en a un) ;
- **l'activité récente** : nouvelles réservations (date, fin de location, commission, état) et
  paiements ;
- **son lien, son affiche QR et son code** à donner de vive voix : il peut imprimer sa propre
  affiche ;
- **le détail par mois** (12 derniers) : dû, payé, reste, et pour chaque réservation la date de
  fin, la commission et l'état seulement : ni numéro, ni montant de location, ni articles, qui
  ensemble pourraient désigner une famille du camping ;
- **ses notifications** : son adresse (celle que la boutique a donnée par défaut) et trois
  interrupteurs : **nouvelle réservation**, **paiement reçu**, **relevé mensuel** (au début de
  chaque mois, s'il a eu des réservations finies le mois passé). Tous activés par défaut ;
  chaque e-mail mène à l'espace, où il les coupe.

L'espace est **à l'image de la boutique** (demande de Téo du 19 novembre) : sa couleur, son
thème clair ou sombre, son logo, sa photo d'accueil en bandeau, un lien « Voir la boutique » et son
adresse en pied de page ; Louez n'y apparaît qu'en « Propulsé par ». Les e-mails au partenaire
prennent aussi la couleur et le logo de la boutique.

**L'affiche QR** (celle de « Premiers clients » comme celle d'un partenaire) porte la boutique :
un bandeau à sa couleur avec son logo sur une carte blanche (ou son nom), « Réservez en ligne »,
« Recommandé par … » sur l'affiche d'un partenaire, puis le QR et « Scannez avec l'appareil
photo de votre téléphone » ; ni adresse imprimée, ni texte d'aide sous l'aperçu (Téo, 19
novembre : le QR suffit). Le QR est dessiné par `qr-code-styling` : modules noirs arrondis et
liés, coins arrondis à la couleur de la boutique, son logo au centre (ou son initiale sur une
tuile à sa couleur si le logo est trop horizontal). Les coins ne prennent la couleur que si elle
contraste assez avec le blanc (4,5:1) ; sinon ils restent noirs, pour que tous les téléphones le
lisent. Le centre cache des modules : le QR est toujours en correction maximale (niveau H).

La page dit que ce n'est pas une facture et que la boutique paie directement. La boutique peut
**changer ce lien** (l'ancien cesse de marcher).

## Où le loueur le trouve

Dans « Se faire connaître », une troisième entrée **« Partenaires »**
(`/dashboard/visibility/partners`), après « Premiers clients » et « Être trouvé par les IA ».
**Pas de carte sur l'accueil.**

- **Liste** : le mois en cours et le total à payer ; un partenaire par ligne (nom, commission,
  réservations du mois, montant à payer). Sous la liste, la durée d'un lien et « Modifier ».
  Vide : trois lignes qui expliquent le principe et le bouton.
- **Ajout** : nom et commission (10 % par défaut) ; l'avantage client (un code promo) s'il y en
  a ; les coordonnées repliées. Après l'ajout, la fiche du partenaire s'ouvre, son lien prêt.
- **Fiche partenaire** (`/dashboard/visibility/partners/<id>`) : sa règle, son avantage, s'il
  reçoit les e-mails ; **son lien** (Copier, Affiche QR, E-mail, WhatsApp), puis **le relevé**
  (mois, dû / payé / reste, Exporter, Marquer comme payé, Ajuster et Retirer par ligne). Modifier,
  copier ou changer le lien de son espace, archiver : derrière un menu.
- **Création d'une réservation** : une carte « Partenaire » (absente sans partenaire).
- **Fiche réservation** : une carte « Partenaire » (qui, par son lien, son code ou à la main,
  commission et état ; changer ou retirer).
- **« À regarder »** (la cloche et sa page) : « Commission à payer » pour chaque mois terminé
  qui doit encore quelque chose à un partenaire, avec le lien vers sa fiche. Elle se marque
  traitée comme les autres.

## Phases

### Phases 1 et 2 — sur la branche, pas fusionnées

Tout ce qui précède : partenaires, lien (cookie sans question), code au paiement, durée
réglable, avantage client, attribution à la main (création et fiche), commission en % ou fixe,
ajustements, états, relevé mensuel, payé, CSV, espace partenaire avec ses notifications
(e-mails par l'outbox : réservation, paiement, relevé du mois), rappel « Commission à payer »,
lecture des partenaires et des relevés pour les assistants (`partners_list`,
`partners_get_statement`, API `GET /partners` et `GET /partners/{id}/statement`). Les écritures
restent dans le dashboard. 13 langues ; événements PostHog ; effacement avec la boutique.

### Phase 3 — Seulement si la demande est forte

- Un office de tourisme qui recommande plusieurs loueurs depuis une seule page.
- Pages co-marquées (« Les vélos recommandés par le camping Les Pins »).

## Hors périmètre

- **Paiement des partenaires par Louez** (virement, Stripe Connect vers le partenaire).
- **Documents fiscaux** (factures de commission, auto-facturation, DAC7) : le relevé et le CSV
  ne sont pas des factures.
- **Compte partenaire** avec mot de passe.
- **Commission sur la caution, la livraison ou l'assurance.**

## Vie privée

- Le partenaire **ne voit aucune donnée du client**, ni ce qui permettrait de le retrouver
  facilement (numéro, montant de location, articles) : une date de fin, une commission, un état.
- Le cookie `louez_partner` est posé sans question au client (décision de Téo du 19 novembre
  2026). La CNIL range les traceurs servant à facturer l'affiliation hors des exemptions de
  consentement (position examinée par le Conseil d'État le 8 avril 2022, n° 452668) : c'est un
  risque assumé, comme pour le cookie reeent `louez_channel`. Si une carte de consentement
  devient nécessaire, elle se pose devant le cookie sans toucher au reste (une première version
  l'avait). Le cookie ne contient que le slug de la boutique, le code et l'heure du clic, sur le
  domaine de la boutique, httpOnly, 90 jours au plus.
- Les coordonnées du partenaire (souvent une personne) sont des données de la boutique :
  effacées avec elle. Ses e-mails ne parlent que de ses gains, et se coupent depuis son espace.
- Le lien de l'espace est un secret : page `noindex`, sans analytics, sans référent, comme les
  pages de handoff ; en mode standalone, il ne passe pas par la vitrine.

## Abus

| Risque                                                     | Réponse                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Le partenaire publie son lien partout (site de bons plans) | Les visites le montrent ; la boutique archive, baisse le taux ou raccourcit la durée                                |
| Commission sur des clients que la boutique avait déjà      | La boutique retire ou ajuste une attribution ; la durée du lien est réglable                                        |
| Le loueur teste le lien sur la tablette du comptoir        | Les réservations faites ensuite depuis la vitrine sur cette tablette iraient au partenaire : la boutique les retire |
| Un partenaire réserve pour lui-même par son lien           | La boutique choisit ses partenaires ; elle retire l'attribution                                                     |
| Deviner un code partenaire au paiement                     | Il ne donne que le nom du partenaire et son avantage, un code promo fait pour circuler                              |
| Commission sur une réservation annulée                     | Annulée avec elle ; une annulation après paiement apparaît en écart négatif                                         |
| Deux partenaires pour une réservation                      | Un seul : le code tapé, sinon le dernier lien, ou le choix de la boutique                                           |
| Lien de l'espace transmis à un tiers                       | Il ne montre rien du client ; il ne permet que de changer les e-mails du partenaire ; la boutique change le lien    |
| Faux code dans l'URL                                       | Un code inconnu de la boutique n'attribue rien                                                                      |

## Auto-hébergé

Tout fonctionne sans service externe : cookie, tables, calcul, relevé, CSV, page du partenaire
(sur l'adresse du dashboard, `NEXT_PUBLIC_APP_URL`). Sans PostHog, aucun événement ne part ; la
base suffit.

## Données

- `store_partners` : boutique, nom, contact (nom, e-mail, téléphone), code (unique par
  boutique), type et valeur de commission, avantage (code promo), secret de l'espace (unique),
  notifications (adresse, trois choix), dernier mois de relevé envoyé, `archived_at`, dates.
- `partner_bookings` : une ligne par réservation attribuée (réservation unique) : partenaire,
  type et valeur de commission **copiés**, origine (`link` | `code` | `manual`), ajustement
  (montant, motif), qui l'a attribuée, quand.
- `partner_payouts` : partenaire, mois (`YYYY-MM`), montant, devise, date, qui.
- `store_partner_settings` : la durée d'un lien, par boutique.
- `page_views.partner_id`.
- Outbox (`api_effects`) : `partner.bookingEmail`, `partner.payoutEmail`,
  `partner.statementEmail`, lus au moment de l'envoi.

Migration additive `0118_partner_links` (quatre tables, une colonne nullable, pas d'index sur
`page_views`).

## Mesure

- **Base** : partenaires créés, réservations attribuées (lien, code, à la main), commissions
  dues et payées, visites par partenaire.
- **PostHog** ([docs/analytics/partners.md](../analytics/partners.md)) : pages vues,
  partenaire ajouté, lien partagé (canal), relevé exporté, mois marqué payé, attribution changée.
- **Succès** : des boutiques dont un partenaire a un **premier mois marqué payé**, puis une
  réservation par lien **le mois suivant** (le partenaire a recommencé). Une réservation par
  lien sous 30 jours ne dit pas si le partenaire a été payé ni s'il continue.

## Questions ouvertes

- Le cookie sans consentement (voir « Vie privée ») : à revoir si la CNIL ou un client le
  conteste.
- Commission due seulement quand la réservation est **intégralement payée** ? Pas pour
  l'instant : la boutique ajuste quand un solde reste impayé.
- Un compte partenaire commun à plusieurs boutiques (un office de tourisme qui recommande
  plusieurs loueurs) : phase 3.

## Annexe — revues croisées

Version précédente de cette spec (avant la carte de consentement) soumise le 19 novembre 2026 à
Codex (OpenAI, `codex exec`, lecture seule) et à Grok (xAI, sans outils ni web), avec la même
question : ce qui est inutile, ce qui manque, ce qui ferait qu'un camping partage vraiment le
lien, ce qu'il faut couper de la phase 1. Réponses complètes dans `.agent-docs/` (non suivi).

### Codex

- Couper : la page du partenaire, les visites, le montant fixe, le code modifiable.
- Manque : « terminée » n'est pas « encaissée » ; remboursement partiel ; écart après paiement
  sans réécrire le passé ; attribution fragile (autre appareil, cookies refusés) ; taux changé
  entre le clic et la réservation.
- **Consentement** : les traceurs d'affiliation rémunérée y sont soumis (position de la CNIL,
  examinée par le Conseil d'État le 8 avril 2022, n° 452668) ; à trancher avant de livrer.
- Retirer l'attribution comme correction « détruit la preuve » : prévoir un ajustement motivé.
- « Aucune obligation légale » est trop général.

### Grok

- Couper : le montant fixe, les visites, le CSV, le reste à payer ; une phase 1 plus courte.
- Manque : client qui réserve sur un autre appareil ; tablette du comptoir ; boutiques qui ne
  passent jamais en « terminée » ; mois déjà payé qui change ; ré-identification par date et
  montant ; office de tourisme public ; facture ; consentement à trancher avant de coder.
- « La commission suit la réservation » et « un remboursement ne change rien » se contredisent.
- Le camping partage si l'affiche est au mur, si la phrase tient en dix secondes et si le
  premier paiement arrive vraiment ; il abandonne si le premier relevé est vide.
- Mesurer un deuxième mois avec réservation et un premier mois payé.

### Ce qui a changé, et ce qui n'a pas changé

Accepté :

- **Consentement du client** avant tout cookie (les deux) : carte « Recommandé par… » sur la
  vitrine ; vérifié auprès des sources de la CNIL et du Conseil d'État.
- **Code jamais modifié** (Codex).
- **Due à la date de fin** pour une réservation confirmée ou en cours, pas seulement à
  `completed` (Grok).
- **Ajustement motivé** par réservation au lieu de retirer l'attribution (Codex) ; une seule
  règle de calcul (Grok).
- **Écart après paiement** affiché, paiement annulable (les deux).
- **Page du partenaire réduite** : date de fin, commission, état ; ni numéro, ni montant de
  location (les deux, ré-identification). Mention « pas une facture » (Grok).
- Office de tourisme public, tablette du comptoir dans les abus ; mesure du succès sur le
  premier paiement et le mois suivant (Grok) ; promesse légale reformulée (Codex).

Gardé malgré les critiques :

- **La page du partenaire** (coupée par Codex, gardée par Grok) : « voici le lien pour
  vérifier » est ce qui donne confiance au partenaire, et c'est la seule façon de lui montrer
  le relevé sans e-mail automatique.
- **Le montant fixe** (les deux voulaient le couper) : demandé dans le cahier des charges, coûte
  un champ, et parle aux boutiques dont les locations ont un prix proche.
- **Les visites** côté boutique (les deux) : comptées seulement après le « oui » du client, sans
  index ni table de plus ; elles disent si l'affiche sert avant la première réservation. Pas
  montrées au partenaire.
- **CSV et reste à payer** (Grok) : demandés par le cahier des charges, et le reste à payer est
  ce qui évite de payer deux fois.
- **« Intégralement payée »** (Codex) : repoussé ; l'ajustement couvre le cas.
- **Partenaire choisi à la création d'une réservation manuelle** (Grok) : phase 2 ; en phase 1,
  la carte de la fiche réservation le fait en un clic.
- **Rappel d'un mois dû** (Grok) : phase 2, dans l'inbox, jamais sur l'accueil (consigne de
  Téo).

### Décisions de Téo (19 novembre 2026)

- Pas de carte de consentement sur la vitrine : le cookie est posé au clic, risque CNIL assumé.
- Un vrai espace pour le partenaire, pour que « ce ne soit pas flou », avec des notifications
  de ses gains.
- Toute la phase 2 avec, sur la branche, sans fusion tant que ce n'est pas propre.

## Related

- [visibilite-boutiques.md](visibilite-boutiques.md) — « Se faire connaître », dont cette page
  est une entrée.
- [../analytics/partners.md](../analytics/partners.md) — les événements PostHog.
- [../architecture/api-and-agents.md](../architecture/api-and-agents.md) — une action, une
  procédure.
