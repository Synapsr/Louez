Louez comptait le stock d'une seule façon : un article part, il revient, il redevient disponible. Le fart, le gaz, les sangles et les sacs n'entraient pas dans ce modèle. Ils y entrent maintenant, sous leur propre type de stock.

## Deux types de stock

La carte **Stock** porte un sélecteur « Type de stock », avec deux valeurs :

- **Stock retournable** — le comportement d'avant, celui de tout votre matériel. L'article revient après chaque location et redevient disponible.
- **Consommable** — l'article part avec le client. Sa quantité n'est plus un parc, c'est un **stock en rayon**.

## Quand le stock bouge

Le stock d'un consommable baisse au moment où la réservation est **confirmée**, pas quand elle est créée. Il remonte si elle est annulée ou refusée. Une réservation terminée le laisse consommé, et c'est le principe même.

Comme l'article ne revient pas, sa disponibilité n'a plus de dimension temporelle. Il n'y a plus de « libre du 12 au 15 » : il y a une quantité en rayon, moins ce que les réservations en cours ont déjà retenu.

## Deux conditions avant d'y accéder

L'option Consommable reste hors de portée tant que deux choses ne sont pas vraies, et le menu vous dit laquelle manque :

- le produit doit être au **forfait** — un consommable ne se facture pas à la durée ;
- il ne doit pas être **suivi à l'unité** — on ne trace pas exemplaire par exemplaire des objets qui ne reviennent pas.

Repassez un consommable en tarification à la durée et il redevient du stock retournable.

## Le type de stock se verrouille

Dès qu'un produit est engagé dans une réservation confirmée ou en cours, le sélecteur laisse place à un bouton **Type de stock verrouillé**, qui ouvre la liste des réservations bloquantes. Elles sont cliquables : annulez-les ou terminez-les, et le choix se rouvre.

C'est voulu. Basculer le type de stock sous une réservation en cours rendrait faux tout ce qui a déjà été décompté.

## Ce que ça donne à l'écran

Sur la fiche produit, un consommable porte un badge **Consommable** et sa quantité s'appelle **Stock en rayon**. Sur la boutique, un consommable épuisé désactive la réservation en disant pourquoi — « Consommable en rupture de stock » — au lieu d'afficher un calendrier vide et inexplicable.

---

Le prix et le stock restent deux réglages séparés, à cette exception près : un consommable se vend au forfait. Voir [Un prix qui ne dépend plus de la durée](/dashboard/whats-new/fixed-pricing).
