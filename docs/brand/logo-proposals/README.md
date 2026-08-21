# Propositions de marque — Louez

Six directions de logo explorées pour remplacer le L blanc sur disque bleu, dessinées, rendues et
testées à taille réelle (favicon 16 px), en monochrome et sur fond sombre.

**[→ Ouvrir la présentation](presentation.html)** — ouvrez le fichier dans un navigateur. Elle contient
le diagnostic du logo actuel, les planches complètes, les mises en situation et la recommandation.

## Les pistes

| Dossier | Nom | EN | Statut |
| --- | --- | --- | --- |
| [`01-etiquette/`](01-etiquette/) | L'étiquette | The Asset Tag | Recommandée |
| [`02-emplacement/`](02-emplacement/) | L'emplacement | The Slot | Retenue |
| [`03-l-ouvert/`](03-l-ouvert/) | Le L ouvert | The Open L | Retenue — repli sûr |
| [`04-le-z/`](04-le-z/) | Le Z | The Return Z | Retenue — demande un typographe |
| [`90-creneau/`](90-creneau/) | Le créneau | The Booking Window | Écartée — lue comme l'outil de recadrage |
| [`91-aller-retour/`](91-aller-retour/) | L'aller-retour | The Round Trip | Écartée — ne communique rien sans terminaison |
| [`00-actuel/`](00-actuel/) | Le logo actuel | Current | Référence — le logo actuel |

## Ce que contient chaque dossier

| Fichier | Rôle |
| --- | --- |
| `mark.svg` | La marque seule, fond transparent. Sites, présentations, goodies. |
| `icon.svg` | L'icône carrée pleine. Favicon, Docker Hub, avatar GitHub, écran d'accueil. |
| `mono.svg` | Une seule couleur via `currentColor`, contre-formes réellement évidées (`fill-rule="evenodd"`), donc valide en réserve sur fond sombre. Factures, tampons, gravure. |
| `lockup-light.svg` | Marque + mot « Louez », calés optiquement, pour fond clair. |
| `lockup-dark.svg` | Idem pour fond sombre. |

Le mot « Louez » des signatures reprend les tracés déjà vectorisés dans
`packages/ui/src/components/logo.tsx` — aucune police n'est requise pour afficher ces fichiers.

## Régénérer

Toute la géométrie est définie une seule fois dans [`_marks.py`](_marks.py) ; les cinq déclinaisons en
sont dérivées. C'est ce qui garantit qu'une marque et son icône d'application ne divergent pas.

```bash
python3 docs/brand/logo-proposals/generate.py   # depuis la racine du dépôt
```

## Couleurs

Les propositions utilisent les valeurs des tokens du dépôt, converties depuis `oklch` :

| Hex | Token | Rôle |
| --- | --- | --- |
| `#265FF2` | `--primary` (thème tableau de bord) | La structure |
| `#F76A13` | `--louez-orange` | L'accent, uniquement là où il porte du sens |

⚠️ Le dépôt contient aujourd'hui **quatre bleus différents** : `#1479FA` (`--primary` de base),
`#265FF2` (`--primary` du tableau de bord), `#0090FF` (`--louez-blue`) et `#1f54dd` codé en dur dans
`apps/web/public/favicon.svg`, `manifest.webmanifest/route.ts`, `scripts/generate-pwa-icons.ts` et les
gabarits d'e-mails. Quelle que soit la piste retenue, il faudra en fixer un seul et le faire descendre
partout depuis le token.

## Statut

Ce sont des **propositions**. Rien ici n'est branché sur l'application : aucun fichier hors de
`docs/brand/` n'a été modifié.
