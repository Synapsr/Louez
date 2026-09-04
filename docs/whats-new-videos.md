# Vidéos de démo — Nouveautés

Checklist de tournage pour les entrées de `apps/web/lib/whats-new.constants.ts`.

## Réglages communs

- Résolution **1440×900**, curseur visible, **sans son**
- Données de démo crédibles — jamais « Produit test » ni « Dupont »
- Afficheur de touches à l'écran (KeyCastr) **obligatoire** pour la vidéo ⌘K
- Export `.mp4` dans `apps/web/public/videos/whats-new/<id>.mp4` + une image poster

## Intégration après tournage

Pour chaque vidéo, ajouter sur son entrée dans `whats-new.constants.ts` :

```ts
media: {
  type: "video",
  src: "/videos/whats-new/<id>.mp4",
  posterSrc: "/images/whats-new/<id>.webp",
},
```

Sans `media`, l'entrée s'affiche en texte seul — aucun placeholder, rien à corriger.

---

## Avancement

- [x] `fixed-pricing` — Un prix qui ne dépend plus de la durée · 40 s · en ligne
- [x] `consumable-stock` — Ce qui part avec le client · 18 s · en ligne (plan 1 seulement)
- [x] `required-accessories` — Le casque part toujours avec le vélo · 57 s · en ligne
- [x] `product-image-ai` — Vos photos produit passent au studio · 52 s · en ligne
- [x] `sidebar-simplified` — Un menu plus court · 45 s · en ligne
- [x] `navigation-refresh` — ⌘K vous emmène partout · 23 s · en ligne
- [x] `product-variants` — Des variantes simples · 46 s · en ligne
- [x] `product-detail-hub` — Chaque produit a sa fiche · 34 s · en ligne
- [x] `reservations-unified-views` — Vos réservations s'ouvrent sur le calendrier · 50 s · en ligne
- [ ] `product-creation-flow-redesign` — Une seule page et votre produit est en ligne (~35 s)
- [x] `reservation-creation-simplified` — Une réservation, une seule page · 53 s · en ligne

### Traitement appliqué

Screen Studio sort en 3468 × 2160, soit **1,605:1 et non 16:9**. Le ratio est conservé
tel quel — les cadres de la page changelog portent `aspect-1734/1080`. Ni rognage (les
zooms vont bord à bord, on couperait de l'UI) ni bandes de remplissage. Enregistrer une
prochaine vidéo dans un autre ratio impose de mettre à jour cette classe dans
`whats-new-entry-media.tsx` et `whats-new-entry-thumbnail.tsx`.

**Exception connue** — `required-accessories` a été exporté en 3604 × 2160, soit 1,669:1.
Le forcer en 1734 × 1080 l'aurait déformé, alors il est encodé en **1802 × 1080**, ratio
d'origine préservé. Dans le cadre `aspect-1734/1080`, `object-contain` lui met environ
2 % de bande grise en haut et en bas ; la vignette, en `object-cover`, rogne autant sur
les côtés. C'est le compromis le moins mauvais sans réenregistrement. Exporter les
prochaines vidéos depuis la même fenêtre Screen Studio évite le problème.

```sh
ffmpeg -i source.mp4 -vf "scale=1734:1080:flags=lanczos,format=yuv420p" \
  -an -c:v libx264 -crf 23 -preset slow -movflags +faststart \
  apps/web/public/videos/whats-new/<id>.mp4

# Poster : choisir une frame qui montre le sujet, pas l'écran d'accueil de départ
ffmpeg -ss <t> -i <id>.mp4 -frames:v 1 -vf "scale=1600:-2:flags=lanczos" poster.png
cwebp -q 82 poster.png -o apps/web/public/images/whats-new/<id>.webp
```

Monter `-crf` à 26 si le fichier dépasse 5 Mo.

`keyboard-shortcuts` n'a pas besoin de vidéo : le tableau des huit raccourcis se lit plus vite qu'il ne se regarde.

---

## 1. `fixed-pricing` — ~30 s

**Tourné le 27/08 — 40 s, en ligne.** Le montage suit le plan et finit sur le panier de la boutique, ligne « fog fluid · Flat rate ». Boutique en anglais, dashboard en français.

Tout tient dans une bascule : le prix arrête de dépendre du temps. Ne pas partir d'un produit vide — partir d'un produit qui a des paliers, pour que la carte se vide à l'écran.

- [ ] **0–5 s** — Fiche produit avec paliers dégressifs et graphique visibles. Plan fixe 2 s sur la carte **Tarification** telle qu'elle est aujourd'hui.
- [ ] **5–12 s** — Ouvrir le select **Mode de tarification** en haut de la carte, choisir **Forfait**. Périodes, paliers et graphique disparaissent. Ne pas couper : c'est le plan qui porte la vidéo.
- [ ] **12–18 s** — Saisir le **Prix forfaitaire**. Montrer la TVA et la caution qui, elles, restent. Enregistrer.
- [ ] **18–26 s** — La même fiche côté boutique : le montant seul, le label **Forfait**, aucun « / jour ». Changer la période dans le sélecteur de dates — le prix ne bouge pas.
- [ ] **26–30 s** — Ajouter au panier. Le total est le même pour deux jours que pour dix.

**À préparer** — [ ] un produit de service crédible (nettoyage, livraison, remise en état) plutôt qu'un vélo, [ ] un produit à paliers dont vous acceptez de perdre les paliers.

**Piège** — la bascule **supprime** paliers et tarifs saisonniers pour de bon. Tourner sur une copie, jamais sur le produit de démo qui sert aux autres vidéos.

---

## 2. `consumable-stock` — ~45 s

**Tourné le 27/08 — 18 s, en ligne, plan 1 seulement.** Le montage montre le passage en Consommable et l'aide « Stock en rayon », puis s'arrête sur la barre « Modifications non enregistrées ». Le stock qui descend après confirmation, l'option grisée, le badge de la fiche et le verrou n'ont pas été tournés. Les plans ci-dessous restent valables pour un complément.

Le stock qui descend est le seul plan qui compte. Tout le reste l'installe.

- [ ] **0–6 s** — Produit déjà au forfait, carte **Stock**. Ouvrir le select **Type de stock**, choisir **Consommable**, enregistrer.
- [ ] **6–12 s** — Sur un second produit tarifé à la durée, rouvrir le même select : **Consommable** est grisé et porte sa raison dans l'option, « Un consommable se vend au forfait ». Refermer sans rien changer.
- [ ] **12–20 s** — Fiche du consommable : badge **Consommable**, quantité intitulée **Stock en rayon**. Plan fixe 2 s sur le chiffre.
- [ ] **20–32 s** — Boutique : réserver le consommable. Retour au dashboard, **confirmer** la réservation, revenir sur la fiche produit. Le stock en rayon a baissé. Pas de zoom, le chiffre suffit.
- [ ] **32–40 s** — Annuler la réservation, revenir sur la fiche : le stock est remonté.
- [ ] **40–45 s** — Sur un produit engagé dans une réservation confirmée, ouvrir le select : **Type de stock verrouillé**, et la liste des réservations bloquantes.

**À préparer** — [ ] un consommable crédible avec un stock à deux chiffres (fart, gaz, sangle), [ ] un produit tarifé à la durée pour le plan de l'option grisée, [ ] une réservation confirmée sur un troisième produit pour le plan du verrou.

**Piège** — le stock bouge à la **confirmation**, pas à la création. Créer la réservation, puis attendre avant de confirmer : sinon on ne voit jamais les deux états.

---

## 3. `required-accessories` — ~40 s

**Tourné le 27/08 — 57 s, en ligne.** Le montage va jusqu'au panier avec la ligne « Casque adulte · Required with … » verrouillée sous le VAE. Boutique en anglais. Seule vidéo de la série avec des photos produit réelles.

Deux moitiés : le réglage côté loueur, l'effet côté client. La seconde vend, la première explique.

- [ ] **0–8 s** — Carte **Accessoires** d'un vélo, ouvrir le sélecteur. Taper dans la recherche, cocher deux produits à la suite : ils restent en place, cochés, et le compteur du pied monte. Fermer.
- [ ] **8–16 s** — Sur le casque, activer **Requis**. Le champ de quantité apparaît, avec « par unité louée » à côté. Laisser le second accessoire sur off — « Simplement suggéré au client ». Enregistrer.
- [ ] **16–26 s** — Boutique, fiche du vélo, ajouter au panier. Le casque se pose seul sous le vélo, **Requis avec Vélo**, sans bouton Supprimer.
- [ ] **26–34 s** — Passer le vélo à 3. La ligne casque passe à 3 toute seule. Essayer de la baisser : le bouton est inactif.
- [ ] **34–40 s** — Supprimer le vélo. Le casque part avec. Fin sur le panier vide.

**À préparer** — [ ] un vélo, un casque et un accessoire facultatif, tous avec photo, [ ] au moins 3 casques en stock, [ ] un catalogue d'au moins six produits pour que la recherche du sélecteur ait de quoi filtrer.

**Variante** — si un accessoire requis à 0 € est prêt, ajouter 3 s sur la ligne **Inclus**. C'est le plan qui fait comprendre l'intérêt commercial.

---

## 4. `product-image-ai` — ~50 s

C'est l'avant qui vend : les photos de départ doivent être moches de façon crédible (fond de cuisine, garage, lumière quelconque). Solde de crédits confortable — l'alerte « Crédits IA insuffisants » ne doit jamais apparaître.

- [ ] **0–6 s** — Formulaire produit, section Photos. Déposer une photo prise « à la maison ». Le dialog **« Que faire de cette photo ? »** s'ouvre : plan fixe 2 s sur les quatre cartes et leurs chips de coût.
- [ ] **6–13 s** — Clic **Améliorer avec l'IA**. La vignette passe en file : état en cours, puis « À valider ». Ne pas accélérer — l'attente est courte et réelle.
- [ ] **13–22 s** — Le dialog **Avant / Après**. Basculer le fond damier → blanc, laisser 3 s de comparaison pleine, puis **Utiliser cette version**. Le badge « Améliorée par IA » apparaît sur la vignette.
- [ ] **22–30 s** — Deuxième photo, menu de la vignette → **Supprimer l'arrière-plan**. Dialog « Arrière-plan supprimé », accepter. Le cadrage d'origine n'a pas bougé — c'est le point.
- [ ] **30–39 s** — Galerie de 3–4 photos hétérogènes : clic **Uniformiser les photos**. Les vignettes avancent une à une — en attente, en cours, à valider. Valider les résultats à la suite.
- [ ] **39–48 s** — Ouvrir **Historique de la photo** sur la première : toutes les versions listées, badge « Utilisée ». Cliquer la version **originale** → la vignette revient en arrière. Re-basculer sur la version IA. Rien n'est perdu.
- [ ] **48–50 s** — Plan final sur la galerie uniformisée : quatre photos, même fond, même cadrage.

**À préparer** — [ ] un vrai produit avec 3–4 photos hétérogènes crédibles (le même objet photographié dans des contextes différents), [ ] un solde de crédits suffisant pour ~5 opérations, [ ] vérifier que la file ne montre aucune photo en échec.

**Piège** — ne pas cliquer Annuler pendant la file : l'annulation est rassurante dans l'app, confuse dans une démo. Et ne pas supprimer de version dans l'historique — le message est « rien ne s'efface ».

---

## 5. `sidebar-simplified` — ~38 s

À chaque entrée disparue du menu, on montre où elle a atterri.

- [x] **0–4 s** — Accueil, menu déplié. Le curseur descend lentement les 8 entrées, sans cliquer. Pause d'une demi-seconde en bas.
- [x] **4–13 s** — Clic **Réservations**. Bascule Liste → Calendrier → Planning, une seconde sur chaque.
- [x] **13–24 s** — Clic **Produits** → ouvrir une fiche. Scroll jusqu'à la section **Inventaire**, pause sur la table des exemplaires.
- [x] **24–29 s** — Clic **Modifier** → le formulaire s'ouvre → retour immédiat vers la fiche.
- [x] **29–36 s** — Clic **Paramètres**. Ouvrir le groupe **Compte et données**, survoler **Abonnement** puis **Parrainage**.
- [x] **36–38 s** — Retour à l'accueil. Plan fixe sur le menu court.

**À préparer** — [ ] un produit en suivi par unité avec des exemplaires, [ ] quelques réservations réparties sur la semaine.

---

## 6. `navigation-refresh` — ~50 s

- [x] **0–4 s** — Sur Réservations. `⌘K` : la palette s'ouvre. 2 s sur les groupes fermés.
- [x] **4–14 s** — Taper un nom de client, lentement. Entrée → sa fiche s'ouvre.
- [x] **14–24 s** — `⌘K`. Taper **« tva »** — la page Taxes remonte. Entrée → le réglage s'ouvre.
- [ ] **24–36 s** — **Paramètres** → barre de recherche → un réglage précis → la page s'ouvre, défile, **le réglage se surligne**. Rester 3 s dessus.
- [x] **36–46 s** — Ouvrir un produit → **Modifier**. Plan sur le fil d'Ariane. Cliquer « Produits » pour remonter.
- [x] **46–50 s** — `⌘K`, « accueil », Entrée.

**À préparer** — [ ] un client au nom distinctif et facile à taper, [ ] vérifier que « tva » remonte bien la page Taxes.

---

## 7. `product-variants` — ~50 s

Le plan final est la **liste des produits**, pas la boutique.

- [x] **0–7 s** — Fiche produit → section stock. Bascule **Quantité simple → Suivi par unité**. Le badge passe de « Par défaut » à « Avancé ».
- [x] **7–15 s** — Plan fixe : **Taille et Couleur sont déjà là**, avec leurs valeurs. Ne pas cliquer.
- [x] **15–21 s** — Ajouter **Pointure** d'un clic. Les valeurs arrivent pré-remplies.
- [x] **21–33 s** — Renseigner 3 exemplaires : une taille pour chacun, puis le **sélecteur de couleur** sur un, avec une teinte hors palette.
- [x] **33–42 s** — **Gérer les variantes** : le catalogue partagé. Renommer une variante.
- [x] **42–50 s** — Retour à la **liste des produits**. Plan fixe sur **une seule ligne** là où il y en aurait eu trois.

**À préparer** — [ ] un produit dont les tailles ont du sens (combinaison, chaussures, vélo), [ ] un catalogue sans doublons par taille.

**Piège** — ne pas filmer la boutique : le sélecteur de combinaison y existait déjà.

---

## 8. `product-detail-hub` — ~60 s

Les plans 3 et 5 doivent être **dans la même prise**.

- [x] **0–4 s** — Liste des produits → clic sur un produit. On arrive sur la fiche, pas sur un formulaire. Plan fixe 2 s.
- [x] **4–14 s** — Panoramique lent sur les **quatre stats**. Temps d'arrêt sur le taux d'utilisation.
- [x] **14–26 s** — Section **Inventaire**. Déclarer une **maintenance** sur un exemplaire, valider.
- [x] **26–40 s** — Section **Réservations** : Liste → Calendrier. **Cliquer-glisser sur une plage libre** → le formulaire s'ouvre, daté et rempli avec ce produit. Retour.
- [x] **40–50 s** — Le **journal d'activité** à droite : la maintenance du plan 3 y apparaît.
- [x] **50–60 s** — Remonter, clic **Modifier** → le formulaire. Retour. Fin sur la fiche complète.

**À préparer** — [ ] un produit en suivi par unité avec 3–4 exemplaires, [ ] un historique de réservations réel (sinon les stats affichent des zéros), [ ] au moins une réservation à venir.

---

## 9. `reservations-unified-views` — ~55 s

On ne clique presque pas, on fait défiler.

- [x] **0–5 s** — Clic **Réservations**. Le calendrier est là, calé sur aujourd'hui. Ne rien toucher 2 s.
- [x] **5–15 s** — Défilement horizontal continu, 3–4 semaines à droite puis retour. **Le libellé du mois doit être dans le cadre.**
- [x] **15–21 s** — Bascule **Semaine → Mois**. Pause : on est resté à la même date.
- [x] **21–32 s** — Survol d'une réservation, carte ouverte **3 s pleines**. Puis curseur sur une ligne produit dedans, sans cliquer.
- [x] **32–45 s** — Filtres : **Départs du jour** → retour à Toutes → filtre **statut**, cocher « Annulées » → filtre **produits**, taper 3 lettres, cocher deux produits.
- [x] **45–55 s** — Bascule **Planning**, défiler (la colonne produits reste collée). Bascule **Liste** → cartes → tableau. Plan final sur le sélecteur de vues.

**À préparer** — [ ] des réservations sur 5–6 semaines, [ ] un départ et un retour aujourd'hui, [ ] une réservation annulée, [ ] **une réservation bien remplie** pour le plan 4 : vrai nom, 2–3 produits, adresses de livraison aller et retour, montant crédible.

---

## 10. `product-creation-flow-redesign` — ~35 s

Le message est « c'est court » : la vidéo doit l'être.

- [ ] **0–4 s** — Produits → **Ajouter un produit**. Plan fixe : une page, trois sections, un panneau à droite.
- [ ] **4–18 s** — Nom, prix, 2 photos déposées. **Aperçu et progression dans le cadre**, ils se remplissent pendant la saisie.
- [ ] **18–26 s** — Descendre jusqu'à Tarification, saisir une quantité, puis rattacher un accessoire dans la carte **Accessoires** — elle est sur la page de création depuis le 27 août. Toujours pas d'assurance ici.
- [ ] **26–35 s** — **Créer et dupliquer**. La copie « (copie) » s'ouvre pré-remplie.

**À préparer** — [ ] 2 photos correctes, [ ] un nom de produit crédible, [ ] un produit déjà en catalogue à rattacher comme accessoire.

---

## 11. `reservation-creation-simplified` — ~55 s

**Un seul mouvement de scroll, pas de coupe.**

- [x] **0–5 s** — Nouvelle réservation. Plan fixe sur la page entière.
- [x] **5–13 s** — **Créer un client** à côté de la recherche : nom, téléphone, valider. Il est sélectionné automatiquement.
- [x] **13–20 s** — Les dates. Le récap commence à se remplir.
- [x] **20–30 s** — Ajouter 2 produits. **Récap et total restent visibles.**
- [x] **30–42 s** — Sur une ligne, **Remise %** → 10. Le prix unitaire résultant s'affiche. Puis une **remise globale**. Le total bouge deux fois.
- [x] **42–49 s** — Ajuster la **caution**. Remonter, changer une date : le total se recalcule.
- [x] **49–55 s** — Valider. Fin sur la réservation créée.

**À préparer** — [ ] deux produits **disponibles** sur la période choisie (sinon la modale de surbooking s'ouvre et casse le rythme).

---

## Arbitrages à trancher

- [ ] **`consumable-stock` s'arrête avant sa démonstration** (18 s au lieu de 45 s). Le plan qui vend la fonctionnalité est le stock qui descend à la confirmation, et il n'est pas dans le montage. Soit on complète, soit on assume que l'article porte l'explication.
- [ ] **La boutique est en anglais dans les trois vidéos**, le dashboard en français. Cohérent pour l'entrée `en`, bancal pour l'entrée `fr` — décider si on refait les plans boutique avec la vitrine en français.
- [ ] **Les données de démo divergent d'une vidéo à l'autre.** `required-accessories` a de vraies photos de vélos ; `fixed-pricing` et `consumable-stock` tournent sur « fog fluid », « smoke machine » et « DEMO », sans photo. Les réglages communs demandent des données crédibles.
- [ ] **Le cliquer-glisser apparaît dans deux vidéos** (`reservations-unified-views` plan 6 et `product-detail-hub` plan 4). Il est décoratif dans la première, structurant dans la seconde — envisager de le couper de la première.
