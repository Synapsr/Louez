# Traceurs du navigateur : ce qui se charge où

Ce que le navigateur charge pour mesurer, enregistrer ou suivre, selon la surface. Côté
serveur, les événements PostHog et le suivi des erreurs
([error-tracking.md](../architecture/error-tracking.md)) ne dépendent pas de la surface.

## Les traceurs

| Traceur                         | Rôle                                                                          | Où il est chargé                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PostHog                         | analytics produit ; erreurs du navigateur, si le projet les capture           | SDK : `PostHogBootstrap` (layout racine). Pages vues : `PostHogProvider` (layouts de chaque surface) |
| Journal client (evlog)          | logs du navigateur, envoyés à l'app elle-même (`/api/evlog/ingest`)           | `EvlogProvider`, layout racine                                                                       |
| Statistiques de la boutique     | visites et provenances, pour le loueur (`/api/track`)                         | `AnalyticsProvider`, providers du storefront                                                         |
| OpenReplay                      | enregistrement de session (projet storefront en mode privé sur les boutiques) | `OpenReplayProvider`, tableau de bord et providers du storefront                                     |
| Umami, fromHello (`t.js`)       | traceurs marketing de l'instance ; Umami en production seulement              | `MarketingTrackers` (`apps/web/components/marketing-trackers.tsx`), layout racine                    |
| Klibon                          | tag d'affiliation (Louez Cloud)                                               | `KlibonTag`, connexion et tableau de bord                                                            |
| Identification fromHello, Gleap | profil du loueur, support                                                     | tableau de bord                                                                                      |

## Par surface

| Surface                                 | PostHog              | Journal client | Statistiques boutique | OpenReplay | Traceurs marketing | Klibon, Gleap |
| --------------------------------------- | -------------------- | -------------- | --------------------- | ---------- | ------------------ | ------------- |
| Tableau de bord, onboarding             | oui                  | oui            | non                   | oui        | oui                | oui           |
| Connexion                               | oui                  | oui            | non                   | non        | oui                | Klibon        |
| Boutique, y compris par la marketplace  | oui                  | oui            | oui                   | oui        | oui                | non           |
| Widget de la boutique (`/[slug]/embed`) | oui, sans pages vues | oui            | non                   | non        | **non**            | non           |
| Handoffs, espace partenaire             | non                  | non            | non                   | non        | non                | non           |

Les démos (démos de la landing, boutiques de démo) suivent [demo-par-metier.md](../demo-par-metier.md).

## Le widget ne charge aucun traceur marketing

Le widget vit dans une iframe sur le site du loueur. Les visiteurs de ce site n'ont pas consenti
aux traceurs de l'instance, et ce que ceux-ci y collecteraient ne sert ni la boutique ni l'instance.
Il garde PostHog, qui remonte ses erreurs, et le journal client.

- **Une seule règle.** `clientTrackingFor` (`apps/web/lib/util.client-tracking.ts`) décide, pour le
  layout racine, ce qui se charge : PostHog et le journal client hors handoffs et démos ; les
  traceurs marketing en plus hors widget. Le widget est reconnu à l'en-tête `x-embed-mode`, que le
  proxy recalcule pour chaque requête : `/embed` sur un hôte de boutique réécrit,
  `/<slug>/embed` sur une URL directe, jamais une route fixe de l'application. Toute valeur
  fournie par le visiteur est retirée. Le prédicat `isEmbedPath` de `apps/web/proxy.ts`
  décide à la fois de cet en-tête et de la CSP
  (`apps/web/lib/embed/util.embed-request.ts`).
- **Un seul endroit.** Un traceur marketing ou un pixel publicitaire tiers s'ajoute dans
  `MarketingTrackers`, jamais ailleurs : il est alors exclu du widget sans autre changement.
- **Un filet.** La CSP du widget (`buildEmbedSecurityHeaders`, `apps/web/lib/util.security-headers.ts`)
  n'est construite qu'à partir des réglages propres à l'instance (son domaine) : l'origine d'aucun
  traceur n'y entre, ni fromHello, ni Umami (même configuré), ni OpenReplay, ni Klibon, ni un traceur ajouté plus tard. Le
  navigateur refuserait un traceur qui atteindrait la page.
- **Dans l'iframe.** Les providers du storefront en variante `bare` n'ont ni OpenReplay, ni pages
  vues PostHog, ni statistiques de la boutique (`components/storefront/shell/storefront-providers.tsx`).

Le code que les loueurs collent sur leur site ne change pas : iframe, redimensionnement et lien vers
le catalogue restent les mêmes.

## Tests

- `apps/web/proxy.routing.test.ts` : en-têtes transmis, CSP et politique de traceurs concordent
  sur les URLs directes, les sous-domaines de boutique, les previews et le mode standalone ;
  les en-têtes forgés ne changent ni la boutique attribuée, ni le mode du widget.

- `apps/web/app/layout.render.test.tsx` : le layout racine d'une page de boutique charge les traceurs
  marketing et PostHog ; celui du widget, PostHog seul ; handoff et boutique de démo, aucun.
- `apps/web/components/storefront/shell/storefront-providers.render.test.tsx` : aucun OpenReplay, ni
  page vue, ni statistique de la boutique dans l'iframe.
- `apps/web/lib/util.security-headers.test.ts` : la CSP du widget n'autorise aucun traceur marketing
  et garde PostHog.
- À la main : [storefront-qa.md](../testing/storefront-qa.md), « Widget sur un autre site ».

## Related

- [error-tracking.md](../architecture/error-tracking.md)
- [demo-par-metier.md](../demo-par-metier.md)
- [storefront-qa.md](../testing/storefront-qa.md)
