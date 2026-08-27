# Demo store seed — Ar Mor Location

Creates one hand-curated store meant for demo recordings, as opposed to
`scripts/seed` which generates four randomised stores for feature testing.

**Ar Mor Location** — location de vélos, VAE, paddles, kayaks et matériel de
bivouac à Concarneau (29). Slug: `ar-mor-location`.

## Run

```bash
# once — uploads the product photos the catalog needs to object storage
pnpm --filter @louez/web db:seed:demo:images

# the store itself (refuses to touch the production database)
pnpm --filter @louez/web db:seed:demo --email=you@example.com --yes

# replace an existing demo store
pnpm --filter @louez/web db:seed:demo --email=you@example.com --yes --reset
```

Options: `--months` (history, default 12), `--reservations` (default 700),
`--customers` (default 180), `--seed` (PRNG seed — same seed, same data),
`--reset`, `--yes`.

## What it creates

| Area | Content |
| --- | --- |
| Store | Plan Ultra, TVA 20 % TTC, acompte en ligne configuré à 30 % (Stripe non relié), livraison 40 km, horaires d'été, CGV et mentions légales, Review Booster, conseiller IA, 3 lieux de retrait, 5 codes promo |
| Équipe | 4 membres (dont le propriétaire) + 2 invitations en attente |
| Catalogue | 5 catégories, 41 produits (dont 1 brouillon et 1 archivé), 164 paliers tarifaires, tarifs de haute saison, 2 axes de variantes (taille, couleur) |
| Inventaire | ~46 unités tracées avec numéros de série, prix d'achat, unités retirées et immobilisations en cours |
| Clients | 180 fiches : locaux, vacanciers français, étrangers, 12 comptes pros |
| Réservations | ~690 sur 14 mois avec saisonnalité réelle (pic juillet-août), tous les statuts, paniers cohérents (couple, famille, itinérance, nautisme, pro) |
| Aujourd'hui | ~18 locations en cours, des départs et des retours du jour, des demandes et devis en attente — le tableau de bord n'est jamais vide |
| Reste | Paiements et empreintes de caution, états des lieux, logs e-mail/SMS, relances, demandes d'avis, liens de paiement, analytics quotidiennes |

## Files

- `catalog.ts` — categories, products, pricing ladders, seasons, units, promo
  codes, inspection templates, CGV.
- `people.ts` — team, customer name pools, business accounts.
- `images.ts` — resolves each product's photos, with fallbacks when the upload
  has not been run.
- `upload-images.ts` — downloads freely-licensed Wikimedia Commons photos and
  uploads them to object storage; writes `demo-images.json`.
- `index.ts` — the seeder itself.

## Notes

- The seed is deterministic for a given `--seed`, except for row ids.
- Photos come from two places: files already hosted for other dev stores
  (bikes, trailers, child seats, panniers, helmets, tent) and the Wikimedia
  Commons set uploaded by `upload-images.ts` (paddles, kayaks, wetsuit, camping
  gear, small accessories). Licences are recorded next to each URL in
  `upload-images.ts`.
- `--reset` deletes every row of the previous demo store, child tables first.
  It only ever targets the store whose slug is `ar-mor-location`.
