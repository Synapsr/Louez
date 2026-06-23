# Referral Program Analytics

Le dashboard PostHog `Louez Referral Program` suit le lancement du programme de parrainage : partage du lien, activation du filleul, attribution, qualification, reward et clawback. Il sert a piloter l'economie du programme, verifier que les guardrails fonctionnent et identifier les prochaines optimisations produit.

## Dashboard

- Outil : PostHog
- Organisation : `Louez.io`
- Projet : `Default project` (`118395`)
- Dashboard : [Louez Referral Program](https://eu.posthog.com/project/118395/dashboard/768585)
- Fenetre par defaut : 90 jours
- Comptes de test : filtres PostHog actives sur les insights

Les events `referral_*` venaient d'etre instrumentes au moment de la creation du dashboard. Ils n'etaient pas encore visibles dans la taxonomie PostHog, donc certains insights peuvent rester vides jusqu'a ingestion des premiers events de production.

## Questions produit

1. Les loueurs voient-ils et utilisent-ils le hub de parrainage ?
2. Le nudge contextuel donne-t-il envie de partager le lien ?
3. Les invites atterrissent-ils correctement depuis un lien de parrainage ?
4. L'attribution store est-elle resolue avec le bon outcome ?
5. Les paiements qualifiants declenchent-ils les bons rewards ?
6. Les rewards sont-ils economiquement sains selon le type de reward ?
7. Les clawbacks restent-ils rares et explicables ?

## Events

| Event                                   | Moment mesure                                 | Usage principal                              |
| --------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| `referral_hub_viewed`                   | Le loueur ouvre le hub de parrainage.         | Mesurer l'exposition organique au programme. |
| `referral_link_copied`                  | Le loueur copie son lien.                     | Mesurer l'intention de partage.              |
| `referral_link_copy_failed`             | La copie du lien echoue.                      | Surveiller la friction technique.            |
| `referral_nudge_viewed`                 | Le nudge de parrainage est affiche.           | Mesurer l'exposition contextuelle.           |
| `referral_nudge_clicked`                | Le loueur clique le nudge.                    | Mesurer l'interet declenche par le nudge.    |
| `referral_nudge_dismissed`              | Le loueur ferme le nudge.                     | Mesurer le rejet ou la fatigue.              |
| `referral_invite_landed`                | Un prospect arrive via un lien de parrainage. | Mesurer le trafic invite.                    |
| `referral_store_attribution_resolved`   | L'attribution est resolue pour un store.      | Verifier les outcomes d'attribution.         |
| `referral_referred_reward_granted`      | Le reward du filleul est accorde.             | Verifier l'avantage immediat cote filleul.   |
| `referral_qualifying_payment_evaluated` | Un paiement est evalue pour qualification.    | Suivre les raisons de grant ou de refus.     |
| `referral_reward_granted`               | Le reward du parrain est accorde.             | Suivre la valeur creee et le cout programme. |
| `referral_reward_clawback_evaluated`    | Un refund/dispute est evalue pour clawback.   | Surveiller les guardrails post-reward.       |
| `referral_reward_clawed_back`           | Un reward est effectivement repris.           | Suivre les reprises reelles.                 |

## Proprietes importantes

Ces proprietes sont utilisees par les insights actuels ou devraient rester disponibles pour les futures analyses.

| Propriete            | Events concernes                                                              | Usage                                                                      |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `outcome`            | `referral_store_attribution_resolved`                                         | Filtrer les attributions reussies (`attributed`) et analyser les refus.    |
| `reason`             | `referral_qualifying_payment_evaluated`, `referral_reward_clawback_evaluated` | Comprendre pourquoi un paiement qualifie, echoue ou declenche un clawback. |
| `granted`            | `referral_qualifying_payment_evaluated`                                       | Segmenter les evaluations positives et negatives.                          |
| `reward_kind`        | `referral_reward_granted`                                                     | Distinguer reservations offertes, credit facture ou autres formes futures. |
| `reward_value_cents` | `referral_reward_granted`                                                     | Evaluer la valeur totale et moyenne des rewards.                           |
| `credit_cents`       | `referral_reward_granted`                                                     | Suivre le cout en credit facture pour les stores abonnes.                  |
| `free_reservations`  | `referral_reward_granted`                                                     | Suivre les reservations offertes accordees.                                |

## Insights crees

### Referrer sharing funnel

- URL : [Referrer sharing funnel](https://eu.posthog.com/project/118395/insights/mxeNS2PS)
- Etapes :
  1. `referral_hub_viewed`
  2. `referral_link_copied`
  3. `referral_store_attribution_resolved` avec `outcome = attributed`
  4. `referral_reward_granted`
- But : mesurer le passage de l'exposition au partage puis au reward obtenu.

### Referral nudge funnel

- URL : [Referral nudge funnel](https://eu.posthog.com/project/118395/insights/Rh48l6Uz)
- Etapes :
  1. `referral_nudge_viewed`
  2. `referral_nudge_clicked`
  3. `referral_link_copied`
- But : mesurer si le nudge contextuel cree une action de partage.

### Referred activation funnel

- URL : [Referred activation funnel](https://eu.posthog.com/project/118395/insights/gQ5Hhlif)
- Etapes :
  1. `referral_invite_landed`
  2. `referral_store_attribution_resolved` avec `outcome = attributed`
  3. `referral_referred_reward_granted`
  4. `referral_reward_granted`
- But : suivre le chemin complet du filleul, de l'arrivee via lien au reward du parrain.

### Qualification / reward health

- URL : [Qualification / reward health](https://eu.posthog.com/project/118395/insights/b19NKLtt)
- Event : `referral_qualifying_payment_evaluated`
- Breakdown : `reason`, `granted`
- But : verifier que les paiements sont qualifies ou refuses pour les bonnes raisons.

### Clawback health

- URL : [Clawback health](https://eu.posthog.com/project/118395/insights/IvgjuVkR)
- Events :
  - `referral_reward_clawback_evaluated`
  - `referral_reward_clawed_back`
- Breakdown : `reason`
- But : surveiller les refunds/disputes et les reprises effectives de reward.

### Program economy

- URL : [Program economy](https://eu.posthog.com/project/118395/insights/Vmo56Cpd)
- Event : `referral_reward_granted`
- Breakdown : `reward_kind`
- Series :
  - count de rewards accordes
  - somme de `reward_value_cents`
  - moyenne de `reward_value_cents`
  - somme de `credit_cents`
  - somme de `free_reservations`
- But : suivre le cout et la valeur du programme sans melanger les unites sur un seul axe.

## Segments utiles a ajouter ensuite

- Plan du referrer : pay-as-you-go, Pro, Ultra.
- Statut du store : nouveau, actif, abonne, churn risk.
- Canal du filleul : landing directe, app, campagne, source UTM.
- Pays ou langue.
- Nombre de locations recentes du referrer.
- Moment d'exposition au nudge : apres paiement, dashboard, settings.
- Taille du paiement qualifiant.
- Cohorte de lancement : avant/apres changement de wording ou montant minimum.

## Prochaines analyses

1. Comparer le taux `referral_nudge_viewed -> referral_link_copied` selon le contexte d'affichage du nudge.
2. Creer une analyse `referral_invite_landed -> signup/onboarding complete` si les events d'onboarding sont deja disponibles dans PostHog.
3. Segmenter `referral_reward_granted` par plan du referrer pour verifier que le credit facture et les reservations offertes sont distribues comme prevu.
4. Analyser les `referral_link_copy_failed` par navigateur et device si le volume augmente.
5. Suivre le ratio rewards accordes / rewards clawed back par semaine.
6. Creer une cohorte "referrers actifs" : stores ayant copie au moins un lien ou obtenu au moins un filleul attribue.
7. Comparer la retention ou l'activation des stores referred versus non-referred.

## Limites connues

- Les premiers insights peuvent etre vides tant que les events `referral_*` ne sont pas ingeres.
- Les proprietes listees ici doivent etre confirmees dans la taxonomie PostHog apres ingestion.
- Les funnels actuels mesurent des sequences utilisateur, pas encore les delais moyens entre etapes.
- Les donnees de storefront et d'app dependent du bon partage d'attribution entre `louez.io` et l'app Louez.

## References

- [Referral Program PRD](../referral-program.md)
- [ADR 0002 - Referral attribution shared cookie](../adr/0002-referral-attribution-shared-cookie.md)
- [ADR 0003 - Referral reward non-cash](../adr/0003-referral-reward-non-cash.md)
