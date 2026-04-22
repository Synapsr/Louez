# Récapitulatif ultra détaillé des tests d’intégration Louez × Tulip

## Contexte

J’ai réalisé une série complète de tests sur l’intégration entre **Louez** et **Tulip**, en couvrant :

- la formule **Inclusion**
  (la garantie est intégrée automatiquement à chaque location sur les matériels paramétrés avec Tulip)
- la formule **Option**
  - mode **non affiché publiquement**
  - mode **optionnel au check-out**

Les tests ont porté sur :

- la connexion API et le rattachement du compte loueur
- la création et le mapping des produits
- la création des contrats d’assurance
- la modification des contrats
- l’annulation des contrats
- l’affichage des badges et statuts d’assurance
- la gestion tarifaire de l’option casse/vol
- le comportement sur la boutique en ligne et dans l’interface loueur Louez

---

# Synthèse exécutive

L’intégration **Louez × Tulip** est aujourd’hui **partiellement fonctionnelle**, mais elle présente plusieurs anomalies structurantes qui empêchent une mise en production fiable sans correctifs.

## Ce qui fonctionne

- le changement de formule **Inclusion / Option** remonte bien de Tulip vers Louez
- le mode **Option non affichée publiquement** est bien pris en compte côté boutique en ligne
- le mode **Option au check-out** fonctionne globalement côté boutique publique
- la création d’un contrat fonctionne dans certains cas nominaux
- la modification de **date de fin** d’un contrat a fonctionné dans au moins un scénario
- lorsqu’un contrat existe bien, Louez affiche un bloc permettant d’ouvrir le contrat Tulip

## Ce qui ne fonctionne pas ou est incorrect

- le rattachement du compte loueur à la clé API Tulip est mal géré
- la validation des champs produit avant création est insuffisante
- Louez masque les vraies erreurs API Tulip derrière des erreurs génériques
- la création de contrat est déclenchée plusieurs fois dans un même parcours
- les modifications de contrat sont mal gérées
- l’ajout / suppression de matériel dans un contrat ne fonctionne pas
- le changement de vélo / numéro de vélo ne fonctionne pas
- l’annulation de réservation ne résilie pas correctement le contrat Tulip
- certains badges “Assuré Tulip” ou “assurable” s’affichent alors qu’aucun contrat valide n’existe
- le pricing assurance est incohérent entre la boutique publique et l’interface loueur
- le mapping des identifiants produit Louez vers Tulip doit être corrigé

---

# Conclusion globale

Le sujet principal n’est pas un simple bug isolé, mais un **problème de modélisation du cycle de vie du contrat d’assurance dans Louez**.

Aujourd’hui, Louez semble :

- créer des contrats trop tôt
- recréer plusieurs fois un même contrat
- mal distinguer simulation, création réelle et modification
- rejouer plusieurs changements précédents au lieu d’envoyer uniquement le delta utile
- afficher des statuts d’assurance qui ne reflètent pas l’état réel côté Tulip

La priorité est donc de **revoir la logique d’intégration de bout en bout**, en séparant clairement :

1. la **simulation**
2. la **création réelle**
3. la **modification**
4. la **résiliation**
5. l’**affichage UI basé sur l’état réel du contrat**

---

# Détail des constats et corrections attendues

---

## 1. Connexion API et rattachement du compte loueur

### Constats

Lors de la saisie de la clé API Tulip dans les paramètres Louez :

- la clé semble acceptée
- mais l’UID du compte loueur n’est pas correctement rattaché à cette clé
- il y a un faux sentiment de succès côté Louez
- le contrôle actuel semble insuffisant

Tu as identifié un point précis :

- au moment où le loueur entre sa clé API, il faut **faire un POST de rattachement du loueur**
- aujourd’hui, ce rattachement ne semble pas être correctement exécuté

### Impact

- le compte Louez peut paraître connecté alors qu’il ne l’est pas réellement
- cela entraîne ensuite des comportements incohérents sur la création de produits et de contrats

### Correction attendue

Au moment de l’enregistrement de la clé API :

1. valider la clé
2. rattacher explicitement le compte loueur à cette clé
3. vérifier que le rattachement est bien effectif
4. afficher une erreur claire si le rattachement n’a pas réellement été fait

### Priorité

**P0 critique**

---

## 2. Création de produit Tulip depuis Louez : validation insuffisante

### Constats

Lorsqu’un produit est ajouté depuis Louez vers Tulip, plusieurs champs indispensables ne sont pas obligatoires dans Louez.

Les champs qui doivent être obligatoires sont :

- catégorie
- sous-type
- marque
- modèle
- prix d’achat HT

Aujourd’hui :

- Louez permet de lancer la création sans ces informations
- Tulip renvoie ensuite une erreur
- mais cette erreur est mal remontée ou mal comprise côté Louez

### Impact

- échec de création produit
- frustration utilisateur
- impression que “Tulip ne fonctionne pas” alors que le problème vient du payload envoyé

### Correction attendue

Rendre ces champs obligatoires **avant envoi API** dans Louez.

Mettre en place :

- validation formulaire stricte
- messages d’erreur précis par champ
- blocage de soumission si les champs requis ne sont pas renseignés

### Priorité

**P0 critique**

---

## 3. Gestion des erreurs : Louez affiche des erreurs génériques

### Constats

Plusieurs fois, Louez affiche un message du type :

- “API Tulip indisponible”

alors que :

- l’API Tulip renvoie en réalité une erreur métier explicite
- cette erreur permettrait de comprendre exactement pourquoi l’action a échoué

Exemples de cas observés :

- création de contrat avec date de début dans le passé
- création de produit incomplet
- erreurs sur les patchs de modification

### Impact

- diagnostic impossible pour le loueur
- perte de temps pour les équipes Tulip
- faux problème technique affiché côté Louez
- impossibilité de comprendre si l’échec est :
  - fonctionnel
  - métier
  - technique
  - lié au payload

### Correction attendue

Louez doit :

- parser les erreurs renvoyées par Tulip
- afficher le vrai motif d’échec
- différencier :
  - erreur de validation
  - erreur métier
  - erreur d’autorisation
  - erreur technique
- remonter le message utile dans l’interface

### Priorité

**P0 critique**

---

## 4. Réservation avec date de début dans le passé

### Constats

Test effectué : création d’une réservation dont la date de début est dans le passé.

Le comportement attendu était :

- **aucun contrat d’assurance ne doit être créé**

Le comportement observé :

- le contrat n’est effectivement pas créé côté Tulip
- mais Louez :
  - n’affiche pas d’erreur claire
  - affiche quand même parfois des badges ou indices laissant croire que le produit est assurable ou assuré
  - peut afficher un logo / badge “Assuré” sur le devis alors que ce n’est pas vrai

Tu as aussi testé avec et sans la logique de création rétroactive, et tu observes que l’UI reste incohérente.

### Impact

- incohérence majeure entre état réel et état affiché
- risque opérationnel
- mauvaise information donnée au loueur et/ou au locataire

### Correction attendue

Mettre en place un statut d’assurance clair côté Louez, par exemple :

- non éligible
- éligible
- simulation disponible
- contrat créé
- échec de création

Le badge “Assuré Tulip” ne doit apparaître **que si le contrat a réellement été créé**.

Un avertissement doit s’afficher quand :

- la réservation démarre dans le passé
- et qu’aucun contrat ne peut être créé

### Priorité

**P0 critique**

---

## 5. Créations multiples de contrats

### Constats

C’est l’un des plus gros problèmes observés.

Sur plusieurs parcours, notamment en inclusion et en option, Louez crée plusieurs contrats pour une même réservation :

- une ou plusieurs créations au moment de la demande du locataire
- puis une nouvelle création au moment de l’acceptation par le loueur

Tu confirmes dans ton complément de transcript que :

- pour une **simulation tarifaire**, il faut utiliser le mode **preview**
- la **création réelle du contrat** ne doit se faire **qu’à la validation de la réservation dans l’interface Louez côté loueur**
- il ne faut **pas** créer de contrat au moment de la simple demande par le locataire

### Impact

- doublons / triplons de contrats
- données erronées dans Tulip
- risque de facturation ou de gestion contractuelle incorrecte
- charge support / ops inutile

### Correction attendue

Règle de gestion cible :

### Étape 1 — Demande de réservation par le locataire

- faire uniquement une **simulation**
- ne pas créer de contrat

### Étape 2 — Réception de la demande côté loueur

- afficher le pricing et l’état d’assurance
- ne pas créer de contrat si la réservation n’est pas encore acceptée

### Étape 3 — Acceptation de la réservation par le loueur

- créer **une seule fois** le contrat Tulip

### Étape 4 — Sécurisation technique

- mettre en place une logique d’idempotence
- empêcher toute création multiple pour une même réservation

### Priorité

**P0 critique**

---

## 6. Formule Inclusion

## Ce qui fonctionne

Sur la boutique publique :

- un encart indique que la garantie casse/vol est appliquée automatiquement
- une ligne de garantie apparaît au récapitulatif
- dans le cas nominal, le contrat finit bien par exister

## Ce qui ne fonctionne pas

- le wording actuel parle de garantie “obligatoire”, alors qu’il faudrait plutôt parler de garantie “intégrée”
- des contrats sont créés trop tôt
- plusieurs contrats peuvent être créés pour une même réservation

## Correction attendue

### Wording à revoir

Remplacer les formulations du type :

- “la garantie casse-vol est obligatoire pour cette réservation”

par :

- “une garantie casse-vol est intégrée à votre réservation et sera appliquée automatiquement”

De même, dans le résumé :

- remplacer “obligatoire” par “intégrée”

### Logique de création à revoir

- ne pas créer de contrat à la demande du locataire
- créer uniquement à l’acceptation du loueur
- garantir l’unicité du contrat

### Priorité

- wording : **P1**
- logique de création : **P0**

---

## 7. Formule Option — mode “optionnel au check-out”

## Ce qui fonctionne

### Côté boutique publique

- le client peut sélectionner la garantie
- le tarif semble bien s’ajouter à la réservation
- sur plusieurs vélos, la logique semble être calculée au niveau de la réservation
- la présence d’un pictogramme / bouclier permet de voir qu’un produit est éligible

Globalement, ce parcours est plutôt bon côté front public.

## Ce qui ne fonctionne pas

### Côté interface loueur Louez

Lorsque la garantie est activée :

- le prix n’est pas clairement affiché
- il n’y a pas de ligne dédiée “garantie casse-vol”
- le total réservation n’est pas mis à jour comme attendu
- l’expérience n’est pas cohérente avec celle de la boutique publique

### Texte à revoir

Le texte actuel du type :

- “Activer cette option pour inclure la garantie casse-vol à votre réservation”

n’est pas idéal.

Il faudrait une formulation plus claire, orientée bénéfice client, par exemple :

- “Protégez votre vélo / matériel / location en cas de casse ou de vol grâce à la garantie Tulip”

### Correction attendue

- harmoniser le calcul tarifaire entre boutique publique et interface loueur
- ajouter une ligne dédiée de type :
  - garantie casse-vol
  - montant
  - statut activé / non activé
- afficher clairement le prix ajouté à la réservation

### Priorité

**P1 élevée**

---

## 8. Formule Option — mode “non affiché publiquement”

## Ce qui fonctionne

- l’encart assurance n’apparaît pas sur la boutique publique
- aucun contrat n’est créé tant que rien n’est sélectionné côté public
- le paramétrage est donc bien respecté côté visibilité publique

## Ce qui ne fonctionne pas

- lorsque la demande arrive dans l’interface Louez du loueur, il n’y a pas de possibilité d’ajouter la garantie
- malgré l’absence de garantie réelle, le badge “Assuré Tulip” apparaît quand même sur certains écrans

### Impact

- badge faux
- logique d’assurance incompréhensible
- impossibilité d’activer la garantie là où elle devrait éventuellement pouvoir l’être

### Correction attendue

Deux points à trancher côté produit :

### Option A

Le mode “non affiché publiquement” signifie :

- invisible côté boutique
- mais activable côté loueur à réception de la demande

### Option B

Le mode “non affiché publiquement” signifie :

- invisible côté boutique
- non activable non plus côté loueur

Dans tous les cas, l’UI doit être alignée avec la règle produit choisie.

Et surtout :

- le badge “Assuré Tulip” ne doit jamais s’afficher sans contrat réel ou sans garantie sélectionnée

### Priorité

**P1 élevée**

---

## 9. Mapping produit : numéro de vélo et identifiant Louez

### Constats

Tu as identifié un point clé sur le mapping du produit entre Louez et Tulip.

Aujourd’hui :

- le numéro réel du vélo / matériel n’est pas correctement transmis dans Tulip
- le champ `product_marked` est utilisé de façon incorrecte
- l’identifiant interne Louez ne doit **pas** être stocké dans `internal_id`

### Règle de mapping attendue

Il faut distinguer clairement :

### 1. Le numéro réel du vélo / matériel

Ce numéro doit être stocké dans :

- `product_marked`

C’est ce champ qui doit contenir le numéro de marquage / numéro du vélo / identifiant physique lisible du matériel.

### 2. L’identifiant interne Louez

Cet identifiant **ne doit pas être stocké dans `internal_id`**.

Il faut :

- ajouter dans `data.*` de l’objet produit un champ dédié
- nommer ce champ : `louez_product_ID`
- y renseigner l’identifiant interne Louez

### Mapping cible

- `product_marked` = numéro réel du vélo / numéro de marquage / numéro physique du matériel
- `data.louez_product_ID` = identifiant interne du produit côté Louez

### Pourquoi cette correction est importante

Cela permet de :

- conserver un vrai champ métier pour l’identification physique du vélo
- garder séparément l’identifiant technique Louez
- éviter les ambiguïtés dans les échanges Tulip × Louez
- faciliter les opérations futures de swap, modification, réconciliation et debug

### Correction attendue

- arrêter d’utiliser `internal_id` pour l’ID Louez
- enrichir le payload produit avec `data.louez_product_ID`
- transmettre le numéro réel du vélo dans `product_marked`
- adapter la logique de lecture et de mise à jour dans Louez en conséquence

### Priorité

**P0 critique**

---

## 10. Bloc contrat visible sur la réservation Louez

### Constats

Quand le contrat est bien créé, Louez affiche :

- un onglet / bloc de contrat
- un numéro de contrat
- un bouton qui permet d’ouvrir le contrat dans Tulip / Colibri

C’est utile, mais l’intitulé pourrait être amélioré.

### Correction attendue

- afficher clairement la marque **Tulip**
- éviter un wording trop orienté “Colibri”, qui est un nom interne / plateforme
- ajouter si possible un bloc “Assurance Tulip” plus complet sur la réservation, avec :
  - statut du contrat
  - numéro du contrat
  - date de création
  - bouton d’ouverture
  - état de synchronisation

### Priorité

**P1**

---

## 11. Modifications de contrat : comportement globalement défaillant

### Constats généraux

La logique de modification de contrat côté Louez est aujourd’hui très instable.

Tu as observé :

- une extension de date de fin qui fonctionne
- mais ensuite de nombreux cas qui ne fonctionnent pas correctement

### Cas qui ne fonctionnent pas correctement

- ajout d’un matériel à un contrat existant
- suppression d’un matériel
- changement de vélo / changement de numéro de vélo
- annulation de réservation
- modification qui met la date de début dans le passé
- rejouement de plusieurs patchs anciens lors d’une seule nouvelle modification

### Symptômes observés

- body de patch incorrect
- présence d’objets qui ressemblent à des payloads de création dans des requêtes de modification
- présence d’objets inutiles dans certains patchs
- plusieurs patchs successifs pour une seule action
- tentatives de rejouer des modifications précédentes au lieu d’envoyer uniquement l’état actuel à atteindre

### Diagnostic

Louez semble mal distinguer :

- modification de contrat
- modification de produit dans le contrat
- ajout de produit
- suppression de produit
- annulation / résiliation

et semble parfois réutiliser des payloads ou historiques qui ne correspondent pas à l’action en cours.

### Correction attendue

La logique doit être entièrement revue autour d’un principe simple :

> à chaque action utilisateur, Louez doit calculer **le delta réel** entre l’état précédent et l’état cible, puis envoyer **une seule action adaptée**.

### Cas à gérer proprement

### a. Modification de dates

- ne modifier que les dates nécessaires
- envoyer uniquement les champs utiles

### b. Swap de vélo / changement de numéro de vélo

- mettre à jour le produit concerné
- répercuter le nouveau `product_marked`
- conserver `data.louez_product_ID` pour la traçabilité Louez

### c. Ajout de matériel

- envoyer une vraie opération d’ajout de produit au contrat
- ne pas essayer de faire cela via un patch générique mal formé

### d. Suppression de matériel

- envoyer une vraie opération de suppression
- ne pas rejouer tout le contenu du contrat

### e. Annulation

- résilier correctement le contrat lié à la réservation

### Priorité

**P0 absolue**

---

## 12. Cas spécifique : modification de date de fin

### Constats

C’est l’un des rares cas de modification qui a semblé fonctionner correctement.

Quand tu as étendu le contrat de 2 jours :

- la modification a bien été prise en compte sur Tulip

### Conclusion

Cela montre que :

- la communication Louez → Tulip peut fonctionner
- mais seulement sur certains cas bien spécifiques
- et que le problème principal est bien la conception générale de la logique de modification, pas une absence totale de capacité technique

### Priorité

Pas de correctif immédiat sur ce point isolé, mais il faut le conserver comme **cas de référence fonctionnel** pour reconstruire la suite.

---

## 13. Ajout d’un matériel à un contrat existant

### Constats

Lorsque tu as essayé d’ajouter un vélo / un article sur une location existante :

- rien ne s’est passé côté contrat
- les logs ont montré une erreur de body
- le patch n’était pas conforme

### Impact

- impossibilité d’ajouter proprement un produit assuré en cours de location
- désynchronisation entre réservation Louez et contrat Tulip

### Correction attendue

Il faut revoir entièrement ce cas de gestion.

Le système doit :

- identifier l’ajout réel d’un nouveau matériel
- créer l’action adaptée
- ne pas réutiliser un payload de type création globale de contrat
- inclure le produit avec ses bons champs métier, dont :
  - `product_marked`
  - `data.louez_product_ID`

### Priorité

**P0**

---

## 14. Suppression d’un matériel

### Constats

La suppression d’un matériel ne fonctionne pas correctement.

### Impact

- contrat Tulip non aligné avec la réservation réelle
- risque de surcouverture ou de mauvaise couverture

### Correction attendue

- gérer explicitement la suppression d’un matériel
- ne pas faire transiter ce cas par une logique générique de patch global
- supprimer uniquement le produit concerné

### Priorité

**P0**

---

## 15. Changement de vélo / changement de numéro de vélo pendant la réservation

### Constats

Tu as observé que :

- la modification du numéro de vélo ne fonctionne pas
- elle ne met pas à jour Tulip
- le lien entre le matériel Louez et le matériel assuré Tulip est insuffisant

### Correction attendue

Quand un vélo est remplacé ou que son numéro change, il faut :

- mettre à jour `product_marked`
- conserver le lien technique via `data.louez_product_ID`
- envoyer une modification propre sur le produit concerné
- ne pas recréer inutilement tout le contrat

### Priorité

**P0**

---

## 16. Annulation de réservation

### Constats

Quand tu annules la réservation :

- l’annulation ne fonctionne pas correctement côté contrat Tulip
- la requête ne semble pas correcte
- le contrat n’est pas résilié comme attendu

### Impact

- contrat actif alors que la réservation est annulée
- gros risque opérationnel et contractuel

### Correction attendue

- aligner l’annulation de réservation Louez avec une vraie résiliation côté Tulip
- s’assurer qu’aucun contrat fantôme ne reste actif
- gérer proprement le cas où aucun contrat n’aurait dû exister

### Priorité

**P0**

---

## 17. Multiples patchs envoyés en cascade

### Constats

Tu as observé un comportement anormal :

- lorsqu’une modification est faite, Louez ne se contente pas d’envoyer le changement actuel
- il semble rejouer plusieurs anciennes modifications successivement
- on voit une succession de patchs liés à différentes modifications historiques

### Impact

- comportement non déterministe
- risque d’erreurs cumulées
- lecture des logs très difficile
- effets de bord imprévisibles

### Hypothèse

Louez conserve probablement un historique local mal exploité ou reconstruit mal l’état cible à partir des changements précédents.

### Correction attendue

La logique de sync doit fonctionner ainsi :

- état précédent connu
- état cible connu
- calcul d’un delta unique
- un seul appel correspondant à l’action utile

Pas de rejeu de l’historique.

### Priorité

**P0**

---

## 18. UX/UI : notifications, boutons et lisibilité

### Constats

Les pop-up / notifications Louez :

- masquent les boutons d’ajout de nouveau produit
- masquent aussi les boutons de modification de l’assurance Tulip
- restent affichées trop longtemps

### Impact

- gêne utilisateur
- clics bloqués
- parcours produit moins fluide

### Correction attendue

- ajouter plus d’espace bas dans l’interface
- permettre de fermer les notifications manuellement
- réduire la durée d’affichage
- s’assurer qu’aucun élément critique ne soit recouvert

### Priorité

**P2**

---

## 19. Dropdown de mapping produit Louez ↔ Tulip

### Constats

Quand Louez affiche la liste des produits Tulip existants pour faire un mapping, la liste est insuffisamment détaillée.

Tu indiques qu’il faut absolument afficher la **valeur hors taxe** dans la liste.

### Pourquoi c’est important

Pour le loueur, cela permet de vérifier qu’il relie bien :

- le bon produit Louez
- au bon produit Tulip

### Correction attendue

Dans le dropdown de sélection, afficher au minimum :

- nom du produit
- sous-type
- marque
- modèle
- valeur HT

### Priorité

**P1**

---

## 20. Paramétrage produit côté Colibri / Mantis

### Constats

Les matériels créés via Louez devraient être identifiables comme tels dans l’écosystème Tulip.

Tu notes aussi qu’il faudrait éviter qu’ils soient modifiés ou supprimés manuellement si cela crée des désynchronisations.

### Correction attendue

Ajouter un indicateur clair d’origine, par exemple :

- produit créé via intégration Louez

et en conséquence :

- restreindre ou encadrer les modifications manuelles
- empêcher les suppressions incohérentes
- afficher la source dans Mantis / Colibri

### Priorité

**P1**

---

# Ce qui fonctionne réellement aujourd’hui

## Fonctionne

- remontée du changement de formule Inclusion / Option
- option non affichée publiquement respectée côté boutique publique
- affichage de l’option côté boutique publique en mode check-out
- création de contrat possible dans certains cas simples
- extension de date de fin fonctionnelle sur un cas
- présence d’un accès au contrat lorsque le contrat existe bien

## Fonctionne partiellement

- inclusion : affichage présent mais wording et logique de création à corriger
- option au check-out : bon fonctionnement côté boutique publique, mais pas côté interface loueur
- badges assurance : présents mais pas fiables

## Ne fonctionne pas

- rattachement effectif du loueur à la clé API
- validation stricte des produits avant création
- remontée des erreurs API Tulip
- gestion des dates passées
- unicité de création de contrat
- ajout de matériel
- suppression de matériel
- swap de vélo / changement de numéro de vélo
- annulation / résiliation
- cohérence des badges assurance
- cohérence du pricing assurance côté Louez back-office
- mapping produit complet et propre

---

# Priorisation recommandée

## P0 — blocants à traiter en premier

1. rattachement du compte loueur à la clé API
2. suppression des créations multiples de contrats
3. utilisation de la simulation uniquement avant acceptation
4. création réelle du contrat uniquement à l’acceptation loueur
5. refonte complète de la gestion des modifications
6. correction du mapping produit :
   - `product_marked` pour le numéro réel du vélo
   - `data.louez_product_ID` pour l’ID interne Louez
7. remontée des vraies erreurs Tulip dans Louez
8. correction des badges “Assuré Tulip” / “assurable”
9. annulation / résiliation de contrat
10. ajout / suppression / swap de matériel

## P1 — important mais non bloquant immédiat

1. affichage d’une ligne tarifaire garantie dans l’interface loueur
2. ajout éventuel de la garantie côté loueur en mode non affiché publiquement
3. enrichissement du dropdown de mapping
4. bloc “Assurance Tulip” plus complet sur la réservation
5. marquage des produits créés via Louez dans Mantis / Colibri
6. wording inclusion / option

## P2 — confort et UX

1. notifications trop envahissantes
2. padding / lisibilité
3. wording orienté Tulip plutôt que Colibri
4. aides contextuelles sur les modes d’assurance

---

# Recommandations produit / tech

## 1. Revoir le cycle de vie de l’assurance dans Louez

Créer une logique cible simple :

### Demande locataire

- simulation uniquement
- pas de contrat créé

### Réception côté loueur

- affichage du pricing
- affichage de l’état d’éligibilité
- pas de contrat si non accepté

### Acceptation loueur

- création d’un seul contrat

### Modifications ultérieures

- un seul delta métier par action
- pas de rejeu de l’historique

### Annulation

- résiliation correcte du contrat lié

---

## 2. Revoir entièrement le mapping produit

Le mapping cible doit être :

- `product_marked` = numéro réel du vélo / marquage du matériel
- `data.louez_product_ID` = identifiant interne du produit côté Louez

Et non :

- `internal_id` pour stocker l’ID Louez

---

## 3. Revoir l’état d’affichage assurance dans Louez

Les badges et labels doivent dépendre d’un vrai statut métier.

Exemple de statuts possibles :

- non éligible
- éligible
- option sélectionnée
- simulation faite
- contrat créé
- échec de création
- contrat résilié

---

## 4. Revoir le moteur de tarification affiché côté Louez

Objectif :

- même logique entre boutique publique et interface loueur
- prix assurance visible partout
- ligne dédiée “garantie casse-vol”
- total mis à jour correctement

---

# Résumé final

## Ce que l’intégration fait bien aujourd’hui

- certains cas simples fonctionnent
- les formules remontent bien
- la boutique publique se comporte globalement mieux que l’interface loueur
- l’extension de date de fin semble fonctionner

## Ce que l’intégration fait mal aujourd’hui

- elle crée trop de contrats
- elle modifie mal les contrats
- elle remonte mal les erreurs
- elle affiche de faux statuts d’assurance
- elle gère mal les cas réels d’exploitation (annulation, ajout, suppression, swap)

## Correction clé à intégrer immédiatement dans la spec

Pour l’identifiant produit Louez :

- **ne pas utiliser `internal_id`**
- **ajouter `data.louez_product_ID` dans l’objet produit**
- **renseigner cet identifiant Louez dans ce champ**
- conserver `product_marked` pour le numéro réel / physique du vélo ou du matériel
