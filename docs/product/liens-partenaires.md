# Liens partenaires — les recommandations locales qui rapportent

Statut : spec ; phase 1 en revue (novembre 2026). Propriétaire : Téo.
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
par ce lien et accepte de créditer le partenaire, Louez **attribue la réservation** et
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
| **Le partenaire** (accueil d'un camping, d'un hôtel…) | Recommander sans effort, et être sûr d'être payé de ce qu'il a apporté                     | Un QR à poser au comptoir, un lien pour le mail de bienvenue ; vérifier ce que son lien a rapporté            |
| **Le client final** (vacancier, futur marié…)         | Réserver vite, au même prix                                                                | Rien de nouveau : la boutique, ses prix, son paiement. Une question, une fois, s'il vient d'un lien           |

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

### Le lien, et le choix du client

`https://<boutique>/?partner=camping-les-pins` (ou n'importe quelle page de la boutique avec
`?partner=`). Lisible, imprimable, et il marche sur les liens de produit.

- **Le client choisit.** La vitrine ouverte par ce lien affiche une petite carte : « Recommandé
  par Camping Les Pins — Voulez-vous que Camping Les Pins soit remercié si vous réservez ? Le
  prix ne change pas. [Non merci] [Oui, avec plaisir] ». Rien n'est enregistré avant le « oui » :
  la CNIL range les traceurs servant à facturer l'affiliation hors des exemptions de
  consentement, et nos vitrines n'ont pas de bandeau cookies. La carte est aussi un argument :
  le client voit que la boutique est recommandée.
- **Attribution** : au « oui », la vitrine pose un cookie httpOnly `louez_partner` sur son
  domaine, **30 jours**, qui nomme la boutique et le code. **Dernier lien partenaire accepté** :
  un autre le remplace ; les liens `via` de la boutique ne le touchent pas.
- **À la réservation** : le checkout lit le cookie côté serveur et attribue la réservation au
  partenaire actif de **cette** boutique qui porte ce code. Un code inconnu ou archivé
  n'attribue rien, une réservation test jamais, une réservation déjà attribuée garde son
  partenaire. Une erreur d'attribution ne fait jamais échouer une réservation.
- **La visite** : `/api/track` lit le même cookie et note le partenaire sur les pages vues
  (`page_views.partner_id`) : la boutique voit si l'affiche sert, avant la première réservation.
- **À la main** : sur la fiche d'une réservation, la boutique l'attribue à un partenaire
  (client venu « de la part du camping » par téléphone, au comptoir, depuis un autre appareil),
  la change, ou la retire.

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

### Ce que voit le partenaire

Un **lien de relevé** secret (`/partner-statements/<secret>`, 43 caractères aléatoires) que la
boutique lui envoie, avec son lien, dans un message prêt (e-mail, WhatsApp). Il ouvre une page
en lecture seule, sans compte : nom de la boutique, mois par mois, dû / payé / reste / à venir,
et pour chaque réservation **la date de fin, la commission et l'état seulement** : pas de
numéro, pas de montant de location, pas d'articles, qui ensemble pourraient désigner une
famille du camping. La page dit que le relevé n'est pas une facture et que la boutique paie
directement. La boutique peut **changer ce lien** (l'ancien cesse de marcher).

## Où le loueur le trouve

Dans « Se faire connaître », une troisième entrée **« Partenaires »**
(`/dashboard/visibility/partners`), après « Premiers clients » et « Être trouvé par les IA ».
**Pas de carte sur l'accueil.**

- **Liste** : le mois en cours et le total à payer ; un partenaire par ligne (nom, commission,
  réservations du mois, montant à payer). Vide : trois lignes qui expliquent le principe
  (ajouter, partager, payer) et le bouton.
- **Ajout** : nom et commission (10 % par défaut) ; les coordonnées sont repliées. Après
  l'ajout, la fiche du partenaire s'ouvre, son lien prêt.
- **Fiche partenaire** (`/dashboard/visibility/partners/<id>`) : **son lien** (Copier, Affiche
  QR au nom de la boutique avec le lien du partenaire, E-mail, WhatsApp), puis **le relevé**
  (mois, dû / payé / reste, Exporter, Marquer comme payé, la liste avec Ajuster et Retirer par
  ligne, les règles en une ligne). Modifier, copier ou changer le lien du relevé, archiver :
  derrière un menu.
- **Fiche réservation** : une carte « Partenaire » (qui, par son lien ou à la main, commission
  et état ; changer ou retirer), absente pour une boutique sans partenaire.

## Phases

### Phase 1 — Le lien, le choix du client, la commission, le relevé (cette PR)

Tout ce qui précède. Procédures `partners.*` en session du dashboard uniquement (comme
`visibility.*`) ; 13 langues ; événements PostHog ; effacement avec la boutique. À tester
d'abord avec quelques boutiques volontaires et un partenaire chacune.

### Phase 2 — Selon ce que les premières boutiques en disent

- **Rappel** quand un mois est dû et pas marqué payé, dans « À regarder » (inbox), pas sur
  l'accueil.
- **Code à dire** au téléphone ou au comptoir, saisi au checkout (« Code partenaire ») ; et le
  partenaire au moment de créer une réservation à la main.
- **Relevé envoyé par e-mail** au partenaire en début de mois.
- **Avantage client** facultatif lié au partenaire (ex. –5 % via le camping), avec les codes
  promo existants.
- **MCP / API** : `partners.list` et `partners.getStatement` en lecture pour les assistants
  (« combien je dois au camping ce mois-ci ? »).
- Fenêtre d'attribution réglable par boutique, si 30 jours ne suffit pas.

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
- Le cookie `louez_partner` n'existe qu'après le « oui » du client ; il nomme la boutique et le
  code du partenaire, sur le domaine de la boutique, httpOnly, 30 jours. Un « non » n'enregistre
  rien.
- Les coordonnées du partenaire (souvent une personne) sont des données de la boutique :
  effacées avec elle.
- Le lien de relevé est un secret : page `noindex`, sans analytics, sans référent, comme les
  pages de handoff ; en mode standalone, elle ne passe pas par la vitrine.

## Abus

| Risque                                                             | Réponse en phase 1                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Le partenaire publie son lien partout (site de bons plans)         | Les visites le montrent ; la boutique archive ou baisse le taux. Le client voit à chaque fois qui il crédite                                   |
| Commission sur des clients que la boutique avait déjà              | Le client choisit de créditer ; la boutique retire ou ajuste une attribution                                                                   |
| Le loueur teste le lien sur la tablette du comptoir et dit « oui » | Les réservations faites sur cette tablette depuis la vitrine iraient au partenaire 30 jours : la boutique les retire ; ne pas accepter en test |
| Un partenaire réserve pour lui-même par son lien                   | La boutique choisit ses partenaires ; elle retire l'attribution                                                                                |
| Commission sur une réservation annulée                             | Annulée avec elle ; une annulation après paiement apparaît en écart négatif                                                                    |
| Deux partenaires pour une réservation                              | Un seul : le dernier lien accepté, ou le choix de la boutique                                                                                  |
| Lien de relevé transmis à un tiers                                 | Il ne montre rien du client ; la boutique change le lien                                                                                       |
| Faux code dans l'URL                                               | Un code inconnu de la boutique n'affiche rien et n'attribue rien                                                                               |

## Auto-hébergé

Tout fonctionne sans service externe : cookie, tables, calcul, relevé, CSV, page du partenaire
(sur l'adresse du dashboard, `NEXT_PUBLIC_APP_URL`). Sans PostHog, aucun événement ne part ; la
base suffit.

## Données

- `store_partners` : boutique, nom, contact (nom, e-mail, téléphone), code (unique par
  boutique), type et valeur de commission, secret du relevé (unique), `archived_at`, dates.
- `partner_bookings` : une ligne par réservation attribuée (réservation unique) : partenaire,
  type et valeur de commission **copiés**, origine (`link` | `manual`), ajustement (montant,
  motif), qui l'a attribuée, quand.
- `partner_payouts` : partenaire, mois (`YYYY-MM`), montant, devise, date, qui.
- `page_views.partner_id`.

Migration additive `0117_partner_links` (trois tables, une colonne nullable, pas d'index sur
`page_views`).

## Mesure

- **Base** : partenaires créés, réservations attribuées (par lien / à la main), commissions
  dues et payées, visites par partenaire.
- **PostHog** ([docs/analytics/partners.md](../analytics/partners.md)) : pages vues,
  partenaire ajouté, lien partagé (canal), relevé exporté, mois marqué payé, attribution changée.
- **Succès** : des boutiques dont un partenaire a un **premier mois marqué payé**, puis une
  réservation par lien **le mois suivant** (le partenaire a recommencé). Une réservation par
  lien sous 30 jours ne dit pas si le partenaire a été payé ni s'il continue.

## Questions ouvertes

- Faut-il un avantage pour le client (–5 %) pour qu'il passe par le lien ? (Phase 2, à tester.)
- La part de clients qui disent « oui » à la carte : si elle est faible, l'attribution à la main
  et le code à dire comptent davantage.
- Commission due seulement quand la réservation est **intégralement payée** ? Pas en phase 1 :
  la boutique ajuste quand un solde reste impayé.

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

## Related

- [visibilite-boutiques.md](visibilite-boutiques.md) — « Se faire connaître », dont cette page
  est une entrée.
- [../analytics/partners.md](../analytics/partners.md) — les événements PostHog.
- [../architecture/api-and-agents.md](../architecture/api-and-agents.md) — une action, une
  procédure.
