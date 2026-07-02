# Analytics

Ce dossier documente les surfaces de donnees Louez : instrumentation, dashboards, funnels, segments, conventions et hypotheses produit. Le but est de rendre le developpement plus data-driven sans perdre le lien avec les decisions produit et les flux metier.

## Objectif

- Savoir quels evenements existent, pourquoi ils existent et quelles proprietes ils portent.
- Garder une trace des dashboards et insights crees dans PostHog ou d'autres outils.
- Standardiser la creation de nouveaux funnels, cohortes et analyses par segment.
- Distinguer ce qui mesure une intention utilisateur, une activation produit, une decision metier, un reward ou un guardrail anti-abus.
- Eviter que chaque feature reparte de zero sur ses metriques.

## Principes

1. Chaque feature importante doit avoir une page dans `docs/analytics/`.
2. Chaque page doit lier les evenements aux questions produit qu'ils permettent de repondre.
3. Les dashboards doivent etre documentes avec leurs URLs, leurs hypotheses et leurs limites connues.
4. Les noms d'evenements doivent rester stables, explicites et centres sur le domaine metier.
5. Les proprietes doivent permettre des segmentations utiles, pas seulement du debug.
6. Les donnees sensibles ou identifiantes ne doivent pas etre documentees ni exposees inutilement.

## Format recommande pour une feature

Chaque nouvelle page analytics devrait contenir :

- `Dashboard` : lien, outil, projet, periode par defaut.
- `Questions produit` : ce que l'on veut apprendre ou surveiller.
- `Evenements` : nom, moment d'emission, proprietes importantes.
- `Funnels et insights` : definition des etapes, filtres, breakdowns.
- `Segments utiles` : plan, store status, pays, canal, source, cohorte, etc.
- `Limites connues` : events recents, trafic faible, tracking incomplet, donnees locales exclues.
- `Prochaines analyses` : idees d'iterations data ou experiments.

## Conventions PostHog

- Verifier le projet PostHog avant de creer un dashboard.
- Utiliser le projet Louez : organisation `Louez.io`, projet `Default project`, id `118395`.
- Filtrer les comptes de test quand l'analyse porte sur le comportement produit reel.
- Preferer une fenetre par defaut explicite (`-90d` pour une feature en lancement, `-30d` pour un suivi courant).
- Documenter les proprietes utilisees comme filtres ou breakdowns.
- Eviter les axes melanges quand les unites different : utiliser une table pour comparer des counts, cents, credits et quantites.

## Replays et friction

- OpenReplay est l'outil de reference pour les replays de sessions Louez.
- PostHog reste l'outil de reference pour les events produit, funnels, cohorts, web vitals et signaux de friction.
- Un `dead click` est un clic sur un element qui semble actionnable mais ne produit pas de retour utile.
- Une `exception` est une erreur runtime ou applicative capturee par l'outil ; elle doit etre traitee comme un signal plus dur qu'un clic de friction, avec vigilance privacy sur les messages et stack traces.

## Pages

- [Core Product Analytics](core-product.md)
- [Referral Program](referral-program.md)
- [Revue du setup analytics — juillet 2026](setup-review-2026-07.md) : etat des lieux, config appliquee, roadmap des manques
