# OpenReplay — parcours de creation dashboard

## Objectif

Completer les signaux quantitatifs PostHog avec des evenements fonctionnels
OpenReplay places dans la timeline des replays. Ces evenements permettent de
retrouver les sessions de creation de reservation et de client, puis de
distinguer les parcours commences des parcours termines.

## Evenements

| Evenement                                  | Moment d'emission                         |
| ------------------------------------------ | ----------------------------------------- |
| `dashboard_reservation_creation_started`   | Affichage du formulaire de reservation    |
| `dashboard_reservation_creation_completed` | Reservation creee avec succes             |
| `dashboard_customer_creation_started`      | Affichage du formulaire de nouveau client |
| `dashboard_customer_creation_completed`    | Client cree avec succes                   |

## Payload

Chaque evenement contient uniquement des proprietes non sensibles :

- `journey` : `reservation_creation` ou `customer_creation` ;
- `step` : `started` ou `completed` ;
- `source` : point d'entree normalise.

Sources prises en charge :

- `direct` ;
- `dashboard_header` ;
- `quick_action` ;
- `onboarding` ;
- `reservations_page` ;
- `customers_page` ;
- `command_palette`.

Ne jamais ajouter de nom, email, telephone, adresse, note, identifiant client ou
identifiant de reservation dans ces payloads.

## Recherches OmniSearch utiles

- evenement `dashboard_reservation_creation_started` sans evenement
  `dashboard_reservation_creation_completed` pour reperer les abandons ;
- evenement `dashboard_customer_creation_started` sans evenement
  `dashboard_customer_creation_completed` ;
- breakdown manuel par `source` pour comparer raccourcis, onboarding et pages
  de liste ;
- `Visited URL contains /dashboard/reservations/new` ou
  `Visited URL contains /dashboard/customers/new` comme filet de securite quand
  un evenement personnalise n'est pas disponible.

Les evenements sont emis uniquement en production, apres le demarrage du tracker.
Une file d'attente locale evite de perdre l'evenement `started` pendant
l'initialisation OpenReplay.

## Dashboard de triage

Le dashboard partage [Louez — Replay Triage](https://replay.lumy.cloud/3/dashboard/7)
regroupe les cartes a consulter avant d'ouvrir les replays :

- `Erreurs JavaScript — sessions a revoir` ;
- `Requetes 4xx/5xx — sessions a revoir` ;
- `Requetes lentes — sessions a revoir` ;
- `Web Vitals — pages a surveiller`.

Le filtre temporel du dashboard est commun a toutes les cartes. Utiliser 24
heures pour le triage quotidien et 7 jours pour la revue produit hebdomadaire.

## References

- [OpenReplay OmniSearch](https://docs.openreplay.com/en/session-replay/omnisearch/)
- [OpenReplay Custom Events](https://docs.openreplay.com/en/product-analytics/custom-events/)
