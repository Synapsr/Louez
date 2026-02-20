# Migration Pricing V2 - Checklist Prod

Date: 2026-02-19  
Branche: `main`  
Contexte: variables DB du package `@louez/db` pointent sur la base de production.

## Objectif

Passer du modèle legacy (`pricing_mode` + `min_duration/discount_percent`) au modèle minute-based V2 (`base_period_minutes` + `period/price`) avec validation avant/après.

## Pré-requis constatés

- Les binaires locaux `tsx` et `drizzle-kit` ne sont pas installés dans cet environnement.
- Exécution opérationnelle faite via `pnpm dlx` (sans modifier l’installation locale).

## Étapes exécutées

### 1) Vérification et correction `pricing_mode`

Commande dry-run:

```bash
pnpm dlx tsx src/scripts/pricing-fix-pricing-mode.ts --dry-run
```

Résultat:

- `productsScanned: 154`
- `productsAlreadyValid: 37`
- `productsFixableFromStore: 117`

Commande apply:

```bash
pnpm dlx tsx src/scripts/pricing-fix-pricing-mode.ts --apply
```

Résultat:

- `productsUpdated: 117`

Re-check dry-run:

```bash
pnpm dlx tsx src/scripts/pricing-fix-pricing-mode.ts --dry-run
```

Résultat:

- `productsAlreadyValid: 154`
- `productsFixableFromStore: 0`

### 2) Prévalidation legacy avant migration schema

Commande:

```bash
pnpm dlx tsx src/scripts/pricing-preflight.ts --fail-on-blockers
```

Résultat:

- `productsScanned: 154`
- `productsReady: 154`
- `productsWithBlockers: 0`
- `productsWithWarnings: 8`
- `tiersScanned: 507`
- `tiersComputed: 507`

Note: warnings = tarifs non strictement progressifs (signal UX/business), pas bloquants pour migration.

### 3) Migration DB (schema)

Commande exécutée (avec dépendances embarquées en `dlx`):

```bash
pnpm dlx --package=drizzle-kit --package=drizzle-orm --package=mysql2 drizzle-kit migrate --config drizzle.config.ts
```

Résultat:

- `migrations applied successfully`

### 4) Backfill V2 (écriture `base_period_minutes`, `tier.period`, `tier.price`)

Dry-run exécuté:

```bash
pnpm dlx tsx src/scripts/pricing-backfill.ts --dry-run
```

Résultat dry-run:

- `productsScanned: 154`
- `productsUpdatedBasePeriod: 154`
- `tiersScanned: 507`
- `tiersUpdated: 507`
- `tiersSkippedMissingLegacyData: 0`

Apply exécuté:

```bash
pnpm dlx tsx src/scripts/pricing-backfill.ts --apply
```

Résultat apply:

- `productsUpdatedBasePeriod: 154`
- `tiersUpdated: 507`

Re-check dry-run:

```bash
pnpm dlx tsx src/scripts/pricing-backfill.ts --dry-run
```

Résultat re-check:

- `productsUpdatedBasePeriod: 0`
- `tiersUpdated: 0`
- `tiersAlreadyBackfilled: 507`

### 5) Parity report (contrôle old vs V2)

Commande exécutée:

```bash
pnpm dlx tsx src/scripts/pricing-parity-report.ts --no-fail
```

Résultat:

- `productsScanned: 154`
- `productsChecked: 154`
- `mismatchedProducts: 66`
- `mismatchedPoints: 19838`
- `maxDiff: 543.20`

Interprétation:

- Le script compare formule legacy vs moteur V2 d’optimisation mixte.
- Les écarts observés sont attendus si les paliers legacy ne garantissent pas une progression monotone strictement équivalente au moteur mixte.
- Décision produit requise: accepter ces écarts (avantage client V2) ou imposer une stratégie de conversion/parité plus stricte.

### 5.1) Rapport ciblé top écarts (top 10 produits)

Commande:

```bash
pnpm dlx tsx src/scripts/pricing-parity-top-products.ts --top 10
```

Résumé:

- `mismatchedProducts: 66`
- Top `maxDiff`:
  - `4vyRQzA4CrzQb8u1L_XlH` (`maxDiff: 543.20`, `mismatchCount: 351`)
  - `o-OmnEg7nZqlC0ZiG498H` (`maxDiff: 160.00`, `mismatchCount: 342`)
  - `HW-2KDIwS2nRGRdwGCIVa` (`maxDiff: 150.00`, `mismatchCount: 243`)
  - `4ntP081V9Oz66D8A3a_oR` (`maxDiff: 88.00`, `mismatchCount: 309`)
  - puis un groupe de produits à `maxDiff: 53.33`

Interprétation rapide:

- Les plus gros écarts se concentrent sur des produits avec paliers legacy non strictement optimaux pour le moteur mixte V2.
- Priorité post-déploiement: revue métier ciblée de ces 10 produits (ou correction automatique des paliers).

## Étapes restantes

### 6) Déploiement application

Après backfill/parity:

1. Déployer runtime web/API V2.
2. Vérifier pricing storefront + checkout + réservations.
3. Monitorer logs mismatch pricing / erreurs de checkout.

## Runbook Déploiement Runtime V2

### A. Avant déploiement

1. Vérifier que `pricing-fix-pricing-mode`, `preflight`, `db:migrate`, `backfill` sont terminés.
2. Exécuter:

```bash
pnpm lint
pnpm type-check:web
pnpm build --filter=@louez/web
```

### B. Déploiement

1. Déployer l’application `web` (et services API associés si séparés).
2. S’assurer que tous les pods/instances tournent sur la version incluant le runtime pricing V2.

### C. Smoke checks immédiats (post-déploiement)

1. Créer/éditer un produit et vérifier la sauvegarde des rates.
2. Vérifier un parcours storefront:
   - fiche produit (affichage des tarifs)
   - modal de pricing
   - ajout panier
   - checkout (recalcul serveur)
3. Vérifier un parcours réservation dashboard (create/edit).

### D. Monitoring 24-48h

1. Surveiller les erreurs server actions checkout/réservations.
2. Surveiller les mismatch de pricing et comparer client/server.
3. Surveiller les anomalies UX reportées (affichage rates, réductions, “à partir de”).

## Checklist Post-Deploy

- [ ] Aucun `pricing_mode` nul restant
- [ ] `base_period_minutes` rempli pour les produits ciblés
- [ ] `product_pricing_tiers.period` et `price` remplis
- [ ] Checkout calcule le même total client/serveur
- [ ] Réservations dashboard cohérentes avec storefront
- [ ] Pas de régression i18n sur les labels pricing
- [ ] Revue des top 10 produits à plus gros écarts validée

## Commandes de vérification recommandées

```bash
pnpm lint
pnpm type-check:web
pnpm build --filter=@louez/web
```

Note: sur cet environnement, `pnpm type-check:web` a déjà montré des erreurs `.next/types/...` non liées à la migration pricing.
