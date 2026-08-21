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

---

## Deuxième série (`v2/`) — sans lettre

La première série a été rejetée : trop plate, grammaire de bibliothèque d'icônes. La deuxième repart d'objets
réels du métier, avec du volume, de la matière et du recouvrement — et sans partir de la lettre L.

**[→ Ouvrir la présentation de la deuxième série](presentation-v2.html)**

| Dossier | Objet | Statut |
| --- | --- | --- |
| [`v2/malle/`](v2/malle/) | La malle à coins renforcés | Recommandée |
| [`v2/diable/`](v2/diable/) | Le diable chargé | La silhouette la plus repérable |
| [`v2/caisse/`](v2/caisse/) | La caisse à fente, en dimétrie 2:1 | Le compromis le plus sûr |
| [`v2/sanglee/`](v2/sanglee/) | La caisse sanglée | Lecture « colis » |
| [`v2/boucle/`](v2/boucle/) | La sangle entrelacée dans sa boucle | Démonstration d'entrelacement |

Géométrie dans [`_marks_v2.py`](_marks_v2.py). Chaque dossier contient `mark.svg`, `mono.svg`,
`lockup-light.svg` et `lockup-dark.svg`.

⚠️ La malle est la seule marque dont le monochrome est un **dessin différent** (corps en contour, coins pleins)
et non la même image en une couleur : évider les coins d'un corps plein réduit la silhouette à une croix.

---

## Troisième série (`v3/`) — mécanisme, matière, état

Les deux premières séries ont exploré **la lettre** puis **l'objet posé**. Celle-ci ouvre les registres
restants. La trouvaille : trois de ces marques sont des **systèmes à deux états** — le logo sait si l'objet
est sorti, ce que le produit sait déjà de chaque article.

**[→ Ouvrir la présentation de la troisième série](presentation-v3.html)**

| Dossier | Idée | Deux états | Statut |
| --- | --- | :-: | --- |
| [`v3/piece/`](v3/piece/) | Un bloc, un morceau détaché, le vide qui l'attend | ✓ | Recommandée |
| [`v3/alveole/`](v3/alveole/) | La même idée creusée dans un volume | ✓ | La plus riche en grand |
| [`v3/casier/`](v3/casier/) | Trois emplacements, un vide | ✓ | La plus explicite |
| [`v3/circuit/`](v3/circuit/) | Les deux faces d'une bande qui tourne | — | La plus sobre |
| [`v3/perforation/`](v3/perforation/) | Le talon détachable | — | Piste ouverte |

Géométrie dans [`_marks_v3.py`](_marks_v3.py). Chaque dossier contient `mark.svg`, `mono.svg`,
`lockup-light.svg`, `lockup-dark.svg`, les déclinaisons `palette-*.svg`, et `state-in.svg` pour les marques
à deux états.

### Registres explorés et abandonnés

| Registre | Résultat |
| --- | --- |
| Le personnage (mascotte) | **Échec** — demande un illustrateur, pas de la géométrie |
| Le geste (trait modulé) | **Échec** — technique acquise, aucune forme signifiante trouvée |
| Le circuit impossible | **Échec** — les jonctions ne survivent pas en dessous de 32 px |
| Le mécanisme (charnière) | Écarté — se lit « classeur à anneaux » |

---

## Quatrième série (`v4/`) — l'idéation d'abord

Réponse au reproche « on ne ressent rien » : cette série commence par l'idéation — six champs
sémantiques écrits avant tout dessin, cinq lentilles en parallèle, **83 idées notées** sur un seul
critère (est-ce qu'on ressent la location ?) — et n'en dessine que quatre, chacune partie d'un
moment vécu.

**[→ Ouvrir la présentation de la quatrième série](presentation-v4.html)**

| Dossier | Moment vécu | Statut |
| --- | --- | --- |
| [`v4/enseigne/`](v4/enseigne/) | Le panonceau suspendu — à louer, et ouvert | **Recommandée** |
| [`v4/ticket/`](v4/ticket/) | Le ticket de consigne : une moitié chacun | Idée la mieux notée de la moisson |
| [`v4/cle-fob/`](v4/cle-fob/) | La clé qu'on vous tend au comptoir | La plus chaleureuse |
| [`v4/cle-sortie/`](v4/cle-sortie/) | Le tableau à clés : sa place l'attend | Piste ouverte |

Géométrie dans [`_marks_v4.py`](_marks_v4.py). Le ticket embarque `state-out.svg` (l'état déchiré).
