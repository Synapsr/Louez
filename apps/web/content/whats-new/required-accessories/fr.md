Les accessoires existaient déjà, mais tous étaient facultatifs : une suggestion au client, libre à lui de la prendre. Certains ne devraient pas l'être. Un casque avec un vélo, un harnais avec une corde, une recharge avec un réchaud.

## Requis, et en quelle quantité

Dans la carte **Accessoires**, chaque accessoire rattaché porte un interrupteur **Requis**. Activez-le et un champ de quantité apparaît : combien d'unités de cet accessoire pour une unité du produit parent. Un casque par vélo, deux gants par paire de skis.

Laissé sur off, l'accessoire ne change pas de comportement : « Simplement suggéré au client. »

## Ce que ça change dans le panier

Quand le client ajoute le produit parent, l'accessoire requis se pose tout seul sous lui, avec la mention **Requis avec …**. La ligne n'a pas de bouton Supprimer et sa quantité ne peut pas descendre sous le minimum.

Elle suit le parent : trois vélos au lieu d'un, et la ligne passe de un casque à trois. Le client peut en ajouter plus s'il en veut plus, dans la limite du stock. Retirer le vélo retire les casques avec.

Facturé zéro, l'accessoire affiche **Inclus** à la place du prix.

## La règle tient aussi côté serveur

Ce n'est pas qu'une politesse d'interface. À la validation de la commande, le serveur recalcule ce que le panier aurait dû contenir et refuse celui à qui il manque un accessoire requis, ou qui n'en a pas la bonne quantité. Un panier fabriqué depuis l'extérieur ne passe pas.

Un accessoire requis en rupture bloque aussi la réservation du produit parent, avec le motif affiché sur la fiche, plutôt qu'un échec au moment de payer.

## Le sélecteur d'accessoires a été refait au passage

Lignes denses avec le prix en ligne, recherche en haut de la fenêtre, et surtout une sélection qui fonctionne comme une bascule : un produit choisi reste à sa place, coché, au lieu de disparaître de la liste sous votre curseur. Le pied de la fenêtre compte ce qui est sélectionné.

Les produits y sont désormais listés dans l'ordre de votre catalogue, le même que sur la page Produits et sur votre boutique.

---

Un accessoire requis est souvent un consommable — la paire de gants qui part avec les skis. Voir [Ce qui part avec le client](/dashboard/whats-new/consumable-stock).
