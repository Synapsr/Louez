<div align="right">

🌐 **Langue**: **Français** | [English](README.md)

</div>

<div align="center">

# 🏠 Louez

### La plateforme open-source de gestion de location

**Arrêtez de payer des abonnements SaaS coûteux. Possédez votre logiciel de location.**

[![Docker](https://img.shields.io/badge/Docker-synapsr%2Flouez-2496ED?style=for-the-badge&logo=docker)](https://hub.docker.com/r/synapsr/louez)
[![GitHub Stars](https://img.shields.io/github/stars/Synapsr/Louez?style=for-the-badge&logo=github)](https://github.com/Synapsr/Louez)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)

[☁️ Cloud](https://louez.io) • [🚀 Auto-hébergé](#-auto-hébergez-en-une-commande) • [✨ Fonctionnalités](#-fonctionnalités) • [📋 Changelog](CHANGELOG.md)

</div>

---

## 🎬 Démo

<div align="center">

<video src="demo-fr.mp4" width="100%" autoplay loop muted playsinline></video>

_Louez en action — de l'installation à la première réservation_

</div>

---

## 💡 Pourquoi Louez ?

Que vous louiez des appareils photo, des outils, du matériel événementiel ou des véhicules — **Louez** vous offre tout ce dont vous avez besoin pour gérer votre activité de location de manière professionnelle.

|                            💸 **Aucun frais mensuel**                            |                           🎨 **Belles vitrines**                            |       🔒 **Vos données vous appartiennent**        |
| :------------------------------------------------------------------------------: | :-------------------------------------------------------------------------: | :------------------------------------------------: |
| Auto-hébergez gratuitement. Pas d'abonnement, pas de commission par réservation. | Chaque boutique dispose d'un catalogue en ligne personnalisable et élégant. | Votre serveur, votre base de données, vos clients. |

|                 ⚡ **Déployez en minutes**                 |                     🌍 **Multilingue**                     |            📱 **Mobile Ready**             |
| :--------------------------------------------------------: | :--------------------------------------------------------: | :----------------------------------------: |
| Une commande et c'est en ligne — base de données incluse. | 8 langues intégrées : FR, EN, DE, ES, IT, NL, PL, PT. | Design responsive pour tous les appareils. |

---

## ☁️ Cloud ou Auto-hébergé — À vous de choisir

<table>
<tr>
<td align="center" width="50%">

### ☁️ Louez Cloud

**Vous ne voulez pas gérer de serveurs ?**

Nous gérons pour vous l'hébergement, les mises à jour, les sauvegardes, les emails, les paiements et l'assistant IA.

**[Commencez gratuitement → louez.io](https://louez.io)**

</td>
<td align="center" width="50%">

### 🖥️ Auto-hébergé

**Vous voulez garder le contrôle ?**

Déployez sur votre propre infrastructure. 100 % gratuit, pour toujours.

**[Déployer maintenant ↓](#-auto-hébergez-en-une-commande)**

</td>
</tr>
</table>

---

## 🚀 Auto-hébergez en une commande

```bash
git clone https://github.com/Synapsr/Louez.git
cd Louez
docker compose up -d
```

**C'est tout.** Ouvrez [http://localhost:3000](http://localhost:3000), créez votre compte et configurez votre boutique. Votre vitrine est servie à la racine du site ; votre tableau de bord vit sous `/dashboard`.

Le [docker-compose.yml](docker-compose.yml) fourni est un déploiement complet et autonome :

- 🗄️ **Base de données incluse** — MySQL tourne à côté de l'application et le schéma s'installe tout seul au premier démarrage
- 🖼️ **Stockage d'images inclus** — un bucket MinIO privé, servi par l'application (pas de port supplémentaire, pas de CDN à configurer)
- 🔑 **Aucun secret à générer** — un secret d'authentification est créé et persisté automatiquement
- ✉️ **Aucun serveur email requis** — connectez-vous par mot de passe ; branchez n'importe quel fournisseur SMTP plus tard pour activer les emails sortants
- 🏪 **Mode boutique unique** — l'instance héberge votre boutique, pas un SaaS

### Utiliser votre propre domaine

Placez un reverse proxy (Caddy, Nginx, Traefik) avec TLS devant le port 3000 et définissez deux variables dans un fichier `.env` à côté du compose :

```bash
NEXT_PUBLIC_APP_URL="https://locations.exemple.fr"
AUTH_URL="https://locations.exemple.fr"
```

### Plateformes en un clic

L'image publiée `synapsr/louez` fonctionne par défaut en mode boutique unique — fournissez une base MySQL et les variables ci-dessus et elle démarre sur EasyPanel, Dokploy, Coolify, Portainer ou Railway. Voir [.env.example](.env.example) pour toute la surface de configuration (stockage S3, SMTP, Stripe, etc.).

### Déploiements multi-boutiques

Louez peut aussi tourner en plateforme multi-boutiques (comme [louez.io](https://louez.io)) : un sous-domaine pour le tableau de bord, un sous-domaine par boutique. Définissez `LOUEZ_MODE=platform` ainsi que les variables de domaine documentées dans [.env.example](.env.example).

> ⬆️ **Vous mettez à jour un auto-hébergement multi-boutiques existant ?** Ajoutez `LOUEZ_MODE=platform` à votre environnement pour conserver le routage par sous-domaines — les nouvelles images démarrent par défaut en mode boutique unique.

---

## ✨ Fonctionnalités

### 📊 Tableau de bord complet

Tout ce qu'il faut pour gérer votre activité de location au même endroit.

|     | Fonctionnalité    | Ce qu'elle apporte                                                              |
| :-: | ----------------- | ------------------------------------------------------------------------------- |
| 📦  | **Produits**      | Gérez l'inventaire avec images, tarifs flexibles et suivi du stock               |
| 📅  | **Réservations**  | Gérez les demandes, les statuts, les départs et les retours                      |
| 🗓️  | **Calendrier**    | Vue semaine/mois de toutes vos réservations                                     |
| 👥  | **Clients**       | Base clients complète avec historique                                            |
| 📈  | **Statistiques**  | Chiffre d'affaires, meilleurs produits, taux d'occupation                        |
| 📄  | **Contrats**      | Contrats PDF générés automatiquement                                             |
| ✉️  | **Emails**        | Confirmations, rappels et notifications automatiques                             |
| 👨‍👩‍👧‍👦  | **Équipe**        | Invitez vos collaborateurs avec des permissions par rôle                         |

### 🛍️ Des vitrines élégantes

Chaque activité de location dispose de sa propre boutique en ligne à son image.

- 🎨 **Personnalisation** — Logo, couleurs, thème clair/sombre
- 📱 **Catalogue produits** — Grille filtrable avec disponibilité en temps réel
- 🛒 **Panier** — Choix des dates, quantités, tarification dynamique
- ✅ **Commande** — Formulaire client, récapitulatif, acceptation des CGV
- 👤 **Espace client** — Connexion sans mot de passe, suivi des réservations
- 📜 **Pages légales** — Conditions générales éditables

### 🤖 Assistant IA

Louez embarque une couche IA complète qui travaille pour votre boutique en continu.

- 💬 **Conseiller IA sur la vitrine** — un assistant de chat sur votre boutique qui recommande le bon matériel depuis votre catalogue en direct, vérifie la vraie disponibilité aux dates du client, répond aux questions sur vos horaires et conditions, et accompagne les visiteurs jusqu'à la réservation. Vous le briefez en langage naturel, comme un nouvel employé.
- 📞 **Réceptionniste vocal IA** — un assistant qui répond à la ligne téléphonique de votre boutique : il traite les questions sur les produits, les prix et la disponibilité, prend des *demandes* de réservation que vous validez depuis le tableau de bord, envoie un récapitulatif SMS à l'appelant et peut transférer vers un humain. Choisissez sa voix (avec pré-écoute), sa langue (8 disponibles), et s'il répond à tous les appels ou seulement hors horaires d'ouverture. Vous pouvez même obtenir un numéro de téléphone sans quitter le tableau de bord.
- 🎛️ **Un seul panneau de contrôle** — configurez les deux assistants, réécoutez les conversations et les appels, et voyez quels échanges se sont transformés en réservations.

L'assistant IA est disponible immédiatement sur **[Louez Cloud](https://louez.io)**. Les auto-hébergeurs peuvent connecter leurs propres fournisseurs d'IA et de téléphonie — la configuration se trouve dans [.env.example](.env.example).

---

## 🛠️ Environnement de développement

Envie de personnaliser ou de contribuer ? Voici comment lancer le projet en local :

```bash
# Cloner le dépôt
git clone https://github.com/Synapsr/Louez.git
cd Louez

# Installer les dépendances
pnpm install

# Configurer l'environnement (crée .env.local à la racine et dans apps/web)
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local

# Initialiser la base de données
pnpm db:push

# Lancer le serveur de développement
pnpm dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) 🎉

---

## 🏗️ Stack technique

Construit avec des technologies modernes et éprouvées :

|     | Technologie      | Rôle                                                |
| :-: | ---------------- | --------------------------------------------------- |
| ⚡  | **Next.js 16**   | Framework React avec App Router                     |
| 📘  | **TypeScript**   | Développement typé                                  |
| 🎨  | **Tailwind CSS 4** | Styles utilitaires                                |
| 🧩  | **Base UI**      | Primitives UI accessibles                           |
| 🗄️  | **Drizzle ORM**  | Requêtes typées vers la base (MySQL)                |
| 🔐  | **better-auth**  | Authentification (mot de passe, codes email, Google) |
| ✉️  | **React Email**  | Templates d'emails soignés                          |
| 📄  | **React PDF**    | Génération des contrats                             |
| 🌍  | **next-intl**    | Internationalisation                                |

---

## 📖 Documentation

- [Guide d'ajout d'intégrations](docs/integrations/adding-an-integration.md)

<details>
<summary><strong>📋 Variables d'environnement</strong></summary>

Le déploiement docker-compose fourni configure toutes les variables requises pour vous. Pour un déploiement personnalisé :

| Variable | Requise | Description |
|----------|:-------:|-------------|
| `DATABASE_URL` | ✅ | Chaîne de connexion MySQL |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL publique de votre application |
| `NEXT_PUBLIC_APP_DOMAIN` | ✅ | Domaine public de votre application |
| `AUTH_URL` | ✅ | URL de connexion (généralement l'URL de l'application) |
| `AUTH_SECRET` | | Secret aléatoire (généré automatiquement par le compose) |
| `S3_*` | | Stockage S3-compatible pour les images (MinIO inclus dans le compose) |
| `LOUEZ_MODE` | | `standalone` (défaut) ou `platform` (routage multi-boutiques) |
| `SMTP_*` | | Emails sortants — optionnel ; les fonctions email se désactivent proprement |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | | Connexion Google — optionnel |
| `STRIPE_*` | | Paiements en ligne — optionnel ; la vitrine bascule en mode demande de réservation |

Les intégrations avancées (fournisseurs d'IA, téléphonie, SMS, analytics, synchronisation calendrier…) sont documentées dans [.env.example](.env.example).

</details>

<details>
<summary><strong>📁 Structure du projet</strong></summary>

```
louez/
├── apps/
│   ├── web/               # Application Next.js (dashboard + vitrines + API)
│   │   ├── app/           # Routes App Router
│   │   ├── components/    # Composants dashboard & vitrine
│   │   ├── lib/           # Logique métier, email, PDF, IA
│   │   └── messages/      # Traductions i18n (8 langues)
│   └── voice-relay/       # Pont vocal streaming optionnel (réceptionniste IA)
├── packages/
│   ├── api/               # Routeurs & services oRPC
│   ├── auth/              # Configuration better-auth
│   ├── db/                # Schéma & migrations Drizzle (MySQL)
│   ├── email/             # Transport & templates email
│   ├── ui/                # Composants UI partagés
│   └── ...                # types, utils, validations, pdf, config
└── docker/                # Dockerfiles de production & entrypoint
```

</details>

<details>
<summary><strong>🔧 Scripts disponibles</strong></summary>

```bash
pnpm dev          # Serveur de développement
pnpm build        # Build de production
pnpm start        # Serveur de production
pnpm lint         # Linter
pnpm format       # Formatage du code
pnpm type-check   # Vérification des types du monorepo
pnpm db:push      # Synchroniser le schéma vers la base
pnpm db:studio    # Ouvrir Drizzle Studio
pnpm db:generate  # Générer les migrations
pnpm db:migrate   # Exécuter les migrations
```

</details>

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voici comment aider :

- 🐛 **Signaler des bugs** — Un problème ? Dites-le nous
- 💡 **Proposer des fonctionnalités** — Une idée ? Ouvrez une discussion
- 🔧 **Soumettre des PRs** — Les contributions de code sont bienvenues
- 📖 **Améliorer la doc** — Aidez les autres à démarrer

### Workflow de développement

```bash
# Fork & clone
git clone https://github.com/VOTRE_USERNAME/louez.git

# Créer une branche
git checkout -b feature/super-fonctionnalite

# Modifier & committer
git commit -m 'Ajoute une super fonctionnalité'

# Pousser & ouvrir une PR
git push origin feature/super-fonctionnalite
```

---

## 🔒 Sécurité

Vous avez trouvé une vulnérabilité ? Merci de la signaler de manière responsable.

📧 **Email** : [security@louez.io](mailto:security@louez.io)

Voir [SECURITY.md](SECURITY.md) pour notre politique de sécurité complète.

---

## 📄 Licence

**Apache 2.0 avec Commons Clause** — voir [LICENSE](LICENSE)

✅ Gratuit pour un usage personnel et interne
✅ Modification et personnalisation libres
✅ Contributions bienvenues
❌ Revente en tant que service commercial interdite sans accord

---

<div align="center">

### ⭐ Mettez une étoile sur GitHub !

Si Louez aide votre activité, montrez-le avec une étoile.

[![Star on GitHub](https://img.shields.io/github/stars/Synapsr/Louez?style=social)](https://github.com/Synapsr/Louez)

---

**Construit avec ❤️ par [Synapsr](https://github.com/synapsr)**

[Signaler un bug](https://github.com/Synapsr/Louez/issues) • [Proposer une fonctionnalité](https://github.com/Synapsr/Louez/discussions) • [Documentation](#-documentation)

</div>
