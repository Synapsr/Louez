# Tarification rate-based : recherche, problematique et solution

## Contexte

Les produits Louez supportent deux modeles de tarification :

1. **Progressif classique** (minDuration + discountPercent) : prix de base par jour/heure/semaine avec reductions progressives.
   Ex : "80EUR/jour, -20% des 3 jours"

2. **Rate-based** (basePeriodMinutes + period/price) : prix fixes pour des durees specifiques.
   Ex : "20EUR/4h, 50EUR/1j, 92.8EUR/2j, 160EUR/3j"

Ce document concerne exclusivement le modele **rate-based**.

---

## Problematique initiale

### Le constat

Le dashboard (creation manuelle de reservation) ne calculait pas correctement les prix des produits rate-based. Il appliquait uniquement la logique du modele progressif classique (minDuration/discountPercent), ignorant completement les paliers rate-based (period/price).

Resultat : le prix affiche etait `basePrice x duration x quantity` sans aucune optimisation de palier.

### Premiere tentative (incorrecte)

La premiere approche a ete d'utiliser un algorithme de programmation dynamique (DP) qui cherchait la combinaison optimale de paliers pour couvrir la duree.

Exemple concret avec la config :
- Base : 20EUR / 4h (240 min)
- Paliers : 50EUR/1j, 92.8EUR/2j, 160EUR/3j, 422.4EUR/11j

Pour une location de **2j 2h** (3000 min) :
- Le DP decompose : 1x palier 2j (92.8EUR) + 1x base 4h (20EUR) = **112.80EUR**
- C'est mathematiquement optimal (combinaison la moins chere)

**Mais ce n'est pas le comportement metier attendu.**

### Le vrai probleme

Le loueur configure ses paliers comme des "forfaits" ou des "tranches tarifaires", pas comme des briques combinables. Le DP qui melange les paliers produit des prix incoherents du point de vue commercial :
- Le client ne comprend pas comment 112.80EUR est calcule
- Ca ne correspond ni a un forfait ni a un prorata
- C'est different de ce que le storefront affiche (partiellement)

---

## La bonne methode de calcul

Le champ `enforceStrictTiers` (booleen par produit, colonne `products.enforce_strict_tiers`) determine le mode de calcul.

### Mode 1 : Strict (`enforceStrictTiers = true`)

**Toggle UI** : "Autoriser une remise progressive" = OFF (decoche, **defaut pour les nouveaux produits**)

Seules les durees exactes des paliers sont proposees. Si la duree tombe entre deux paliers, on arrondit au palier **superieur**.

**Algorithme** :
```
1. Lister toutes les periodes disponibles : [basePeriod, ...tier.period]
2. Trouver la plus petite periode >= duree de la location
3. Facturer le prix exact de ce palier
```

**Exemple** : Location de 2j 2h (3000 min)
- Periodes disponibles : [240, 1440, 2880, 4320, 15840]
- Plus petite >= 3000 → 4320 (3j)
- **Prix = 160EUR**

**Cas limite** : Si la duree depasse tous les paliers, on bascule sur le mode progressif depuis le palier le plus grand (fallback raisonnable).

### Mode 2 : Progressif (`enforceStrictTiers = false`)

**Toggle UI** : "Autoriser une remise progressive" = ON (coche)

#### Implementation actuelle (taux/minute du palier plancher)

On cherche le palier le plus haut dont la periode est inferieure ou egale a la duree, on calcule le tarif a la minute depuis ce palier, et on multiplie par la duree reelle.

**Algorithme actuel** :
```
1. Lister tous les tarifs : [{base}, ...tiers], tries par periode croissante
2. Trouver le plus grand tarif avec periode <= duree de la location
3. Tarif/minute = tarif.price / tarif.period
4. Total par unite = tarif/minute x duree en minutes
```

**Exemple** : Location de 2j 2h (3000 min)
- Palier applicable : 2j (period=2880, price=92.8EUR) car 2880 <= 3000
- Tarif/minute : 92.8 / 2880 = 0.03222 EUR/min
- **Total = 0.03222 x 3000 = 96.67EUR**

**Cas limite** : Si la duree est inferieure au plus petit palier (y compris la base), on facture 1 periode de base minimum.

#### Probleme identifie : discontinuites et prix aberrants

L'algo actuel extrapole lineairement le taux/minute du palier plancher. Quand la duree tombe entre deux paliers eloignes, cela produit deux anomalies :

**1. Cliffs aux frontieres de palier** — Le prix chute brutalement en passant d'un palier au suivant.

```
Config : base 20EUR/4h, tier 1j=50EUR

A 23h59 (1439 min) : taux base 20/240 = 0.0833 → 0.0833 x 1439 = 119.92EUR
A 1j    (1440 min) : taux 1j  50/1440 = 0.0347 → 50EUR

→ Cliff de 70EUR pour 1 minute de difference !
```

**2. "Louer plus longtemps coute moins cher"** — L'extrapolation depuis le palier plancher peut depasser le prix du palier suivant.

```
Config : base 20EUR/4h, tier 3j=160EUR, tier 7j=300EUR

Pour 6j (8640 min) :
  tier applicable = 3j, taux = 160/4320 = 0.03704
  total = 0.03704 x 8640 = 320EUR

Pour 7j (10080 min) :
  tier applicable = 7j, taux = 300/10080 = 0.02976
  total = 300EUR

→ 6j coute 320EUR mais 7j coute 300EUR !
```

La courbe de prix avec l'algo actuel :

```
Prix EUR
400 |         x (6j23h = 373EUR)
350 |       x
320 |     x (6j = 320EUR)
300 |          o---------o  (7j = 300EUR)
250 |   x
200 | x
160 o (3j = 160EUR)
    +---+---+---+---+---+---+---> Duree
    3j  4j  5j  6j  7j  8j
```

La cause fondamentale : l'algo utilise un taux/minute **constant** entre deux paliers (celui du palier plancher). Or les paliers ont en general des taux/minute decroissants (remise de volume), donc l'extrapolation monte plus vite que le prix reel du palier suivant.

#### Solution cible : interpolation lineaire entre paliers

Les paliers definis par le loueur sont des **points d'ancrage** sur une courbe prix/duree. Entre deux paliers consecutifs, le prix doit evoluer en **ligne droite** de l'un a l'autre.

**Algorithme cible** :
```
1. Trier tous les tarifs (base incluse) par periode croissante
2. Pour une duree d :
   a. Si d <= plus petite periode → prix = prix de base (minimum)
   b. Si d tombe entre palier A et palier B (consecutifs) :
        ratio = (d - A.period) / (B.period - A.period)
        prix = A.price + (B.price - A.price) x ratio
   c. Si d >= plus grand palier → taux/min du dernier palier x d
      (extrapolation lineaire depuis le dernier palier, meme fallback qu'en strict)
```

**Exemple** avec config : base 20EUR/4h, tier 1j=50EUR, tier 2j=92.8EUR, tier 3j=160EUR

```
Duree       | Paliers encadrants     | Calcul interpolation          | Prix
------------|------------------------|-------------------------------|-------
4h   (240)  | exact palier base      | -                             | 20EUR
12h  (720)  | base(240,20) → 1j(1440,50) | 20 + 30 x (720-240)/(1440-240)  | 32EUR
18h  (1080) | base(240,20) → 1j(1440,50) | 20 + 30 x 0.7                   | 41EUR
23h59(1439) | base(240,20) → 1j(1440,50) | 20 + 30 x 0.999                 | 49.97EUR
1j   (1440) | exact palier 1j        | -                             | 50EUR
1j12h(2160) | 1j(1440,50) → 2j(2880,92.8)| 50 + 42.8 x 0.5               | 71.40EUR
2j   (2880) | exact palier 2j        | -                             | 92.80EUR
2j12h(3600) | 2j(2880,92.8) → 3j(4320,160)| 92.8 + 67.2 x 0.5            | 126.40EUR
3j   (4320) | exact palier 3j        | -                             | 160EUR
4j   (5760) | au-dela du dernier     | 160/4320 x 5760               | 213.33EUR
```

**Comparaison avec l'algo actuel** (meme config) :

```
Duree   | Actuel (taux plancher) | Interpolation lineaire | Ecart
--------|------------------------|------------------------|-------
12h     | 60EUR                  | 32EUR                  | -28EUR
18h     | 90EUR                  | 41EUR                  | -49EUR
23h59   | 119.92EUR              | 49.97EUR               | -70EUR
1j      | 50EUR                  | 50EUR                  | =
1j12h   | 75EUR                  | 71.40EUR               | -3.60EUR
2j      | 92.80EUR               | 92.80EUR               | =
2j12h   | 116EUR                 | 126.40EUR              | +10.40EUR
3j      | 160EUR                 | 160EUR                 | =
```

Visuellement :

```
Algo actuel (taux constant par segment)    Interpolation lineaire

Prix EUR                                    Prix EUR
160 |                  o 3j                 160 |                o 3j
    |               /·                          |              /
120 |          ···x (cliff!)                    |            /
 93 |         o 2j                           93 |          o 2j
    |      /·                                   |        /
 50 |  ··x (cliff!)                          50 |      o 1j
    | o 1j                                      |    /
 20 o base                                   20 | o base
    +---+---+---+---→                           +---+---+---+---→
     4h  1j  2j  3j                              4h  1j  2j  3j
```

**Garanties de l'interpolation lineaire** :

1. **Les paliers sont respectes exactement** — Chaque palier du loueur est un point fixe de la courbe
2. **Courbe continue** — Pas de cliff, le prix evolue sans rupture
3. **Monotoniquement croissante** — Louer plus longtemps ne coute jamais moins cher (si les prix des paliers sont croissants, ce qui est le cas normal)
4. **Simple a expliquer** — "Le prix progresse lineairement entre vos paliers"
5. **Prix juste pour le client** — Pas de surcharge entre les paliers, pas de paradoxe "7j moins cher que 6j"

**Cas limite : paliers avec prix non-monotone** — Si un loueur configure un palier avec un prix/minute plus eleve que le precedent (ex: 2j=92.80EUR a 0.0322EUR/min, 3j=160EUR a 0.0370EUR/min), l'interpolation lineaire produit une pente plus raide sur ce segment. C'est un comportement correct : le loueur a defini un forfait 3j a 160EUR, et le prix transite lineairement vers ce forfait. Le loueur devrait etre averti dans l'editeur si ses paliers ne suivent pas une courbe de remise progressive.

### Prix de reference (sans remise)

Pour les deux modes :
```
originalSubtotal = ceil(durationMinutes / basePeriodMinutes) x basePrice x quantity
```

Represente ce que le client paierait au tarif de base sans aucun palier.

### Economies et pourcentage de reduction

```
savings = max(0, originalSubtotal - subtotal)
reductionPercent = (savings / originalSubtotal) x 100
```

---

## Comparaison des quatre approches

Config : base 20EUR/4h, paliers 1j=50EUR, 2j=92.80EUR, 3j=160EUR

| Duree | DP (rejete) | Strict | Progressif actuel (taux plancher) | Progressif cible (interpolation) |
|-------|------------|--------|-----------------------------------|----------------------------------|
| 2h (120 min) | 20EUR | 20EUR (snap base) | 20EUR (min 1 base) | 20EUR (min base) |
| 4h (240 min) | 20EUR | 20EUR | 20EUR | 20EUR |
| 12h (720 min) | 60EUR | 50EUR (snap 1j) | 60EUR | 32EUR |
| 23h59 (1439 min) | 119.92EUR | 50EUR (snap 1j) | 119.92EUR | 49.97EUR |
| 1j (1440 min) | 50EUR | 50EUR | 50EUR | 50EUR |
| 2j (2880 min) | 92.80EUR | 92.80EUR | 92.80EUR | 92.80EUR |
| 2j 2h (3000 min) | 112.80EUR | 160EUR (snap 3j) | 96.67EUR | 101.13EUR |
| 3j (4320 min) | 160EUR | 160EUR | 160EUR | 160EUR |

Observations :
- **DP** : prix incoherents (melange de paliers), rejete
- **Strict** : snap au palier superieur, pas de prix intermediaires
- **Progressif actuel** : cliffs de 70EUR aux frontieres, 12h (60EUR) > 1j (50EUR)
- **Progressif cible** : courbe lisse, pas de cliff, tous les paliers respectes

---

## Impact sur la base de code

### `enforceStrictTiers` dans la DB

- Colonne : `products.enforce_strict_tiers`
- Type : `boolean NOT NULL DEFAULT false`
- **Defaut DB** : `false` (progressif) -- pour les produits existants avant l'ajout du champ
- **Defaut formulaire** : `true` (strict) -- pour les nouveaux produits crees via l'UI

### Inversion du toggle UI

Attention a l'inversion semantique :
- Toggle **OFF** (decoche) = `enforceStrictTiers = true` = mode strict
- Toggle **ON** (coche, "Autoriser une remise progressive") = `enforceStrictTiers = false` = mode progressif

### Fichiers impactes

**Fonction centrale** : `packages/utils/src/pricing/calculate.ts` → `calculateRateBasedPrice()`

**Consommateurs qui passent `enforceStrictTiers`** :
- Dashboard : `use-new-reservation-pricing.ts`, `reservations/actions.ts` (3 call sites)
- Storefront : `add-to-cart-form.tsx`, `product-card-available.tsx`, `product-modal.tsx`, `checkout/actions.ts`
- Cart : `cart-context.tsx` (2 call sites)
- Editor : `rates-editor.tsx` (passait deja le flag)

### L'algorithme DP (supprime)

L'algorithme DP (`calculateBestRate`) a ete supprime du code. Il combinait les paliers comme des briques (ex: 1x2j + 1x4h = 112.80EUR pour 2j2h), ce qui ne correspondait pas au comportement metier attendu. Le mode progressif utilise desormais l'interpolation lineaire entre paliers.

---

## Points d'attention

### 1. Coherence storefront / dashboard / serveur

Les trois doivent utiliser exactement la meme logique. Le serveur (actions.ts) recalcule le prix a partir de la DB (pas du client) -- c'est le prix de verite. Le client (dashboard et storefront) doit produire le meme resultat pour eviter les surprises a la validation.

### 2. Affichage du mode strict sur le storefront

Quand `enforceStrictTiers = true`, le storefront devrait idealement :
- Restreindre le date picker aux durees correspondant aux paliers
- Ou afficher clairement "Facture sur X jours" quand la duree est arrondie

Aujourd'hui le storefront pre-snap la duree via `snapToNearestRatePeriod()` avant d'appeler `calculateRateBasedPrice()`, ce qui donne un resultat correct mais l'UX pourrait etre amelioree.

### 3. Panier et localStorage

Le `CartItem` stocke `enforceStrictTiers` en localStorage. Les anciens paniers (avant cette migration) n'auront pas ce champ -- le default `false` (progressif) s'applique, ce qui est coherent avec le default DB.

### 4. Override de prix (dashboard)

Quand le loueur fait un override de prix sur un produit rate-based, le `calculatedPrice` (prix unitaire par periode derive du calcul) est utilise comme reference dans le dialog. Pour le mode strict, c'est le prix du palier divise par la duree et la quantite. Pour le progressif, c'est le tarif/minute converti en tarif/periode.

### 5. Edge case : duree > tous les paliers en mode strict

Actuellement, si la duree depasse le plus grand palier en mode strict, on bascule en mode progressif depuis le plus grand palier. C'est un fallback raisonnable mais le loueur devrait etre informe qu'il manque un palier pour cette duree.

### 6. Produits non rate-based

Les produits classiques (pricingMode = day/hour/week sans basePeriodMinutes) continuent d'utiliser `calculateRentalPrice` avec la logique `findApplicableTier` existante. Rien ne change pour eux.

### 7. Validation des paliers dans l'editeur

Quand le loueur active le mode progressif, l'editeur de paliers devrait avertir si les prix ne sont pas croissants (ex: palier 3j a 160EUR plus cher/minute que palier 2j a 92.80EUR). L'interpolation lineaire produit une pente plus raide sur ce segment, ce qui est correct mathematiquement mais pourrait surprendre le loueur.

### 8. Calcul du `reductionPercent` avec interpolation

Le pourcentage de reduction reste base sur `originalSubtotal` (cout au tarif de base pur). Avec l'interpolation lineaire, les reductions entre paliers seront plus graduelles que l'algo actuel, ce qui est le comportement attendu.
