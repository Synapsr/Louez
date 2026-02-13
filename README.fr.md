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

[☁️ Cloud](https://louez.io) • [🚀 Auto-hébergé](#-déployer-en-30-secondes) • [✨ Fonctionnalités](#-fonctionnalités) • [🗺️ Roadmap](ROADMAP.md) • [📋 Changelog](CHANGELOG.md)

</div>

---

## 🎬 Démo

<div align="center">

<video src="demo-fr.mp4" width="100%" autoplay loop muted playsinline></video>

_See Louez in action — from setup to first booking_

</div>

---

## 💡 Pourquoi Louez ?

Que vous louiez des appareils photo, des outils, du matériel événementiel ou des véhicules — **Louez** vous offre tout ce dont vous avez besoin pour gérer votre activité de location de manière professionnelle.

|                            💸 **Aucun frais mensuel**                            |                           🎨 **Belles vitrines**                            |       🔒 **Vos données vous appartiennent**        |
| :------------------------------------------------------------------------------: | :-------------------------------------------------------------------------: | :------------------------------------------------: |
| Auto-hébergez gratuitement. Pas d'abonnement, pas de commission par réservation. | Chaque boutique dispose d'un catalogue en ligne personnalisable et élégant. | Votre serveur, votre base de données, vos clients. |

|       ⚡ **Déployez en minutes**       |                         🌍 **Multilingue**                         |            📱 **Mobile Ready**             |
| :------------------------------------: | :----------------------------------------------------------------: | :----------------------------------------: |
| Une commande Docker et c'est en ligne. | Français et anglais intégrés. Ajoutez d'autres langues facilement. | Design responsive pour tous les appareils. |

---

## ☁️ Cloud ou Auto-hébergé — À vous de choisir

<table>
<tr>
<td align="center" width="50%">

### ☁️ Louez Cloud

**Vous ne voulez pas gérer de serveurs ?**

On s'occupe de l'hébergement, des mises à jour, des sauvegardes, des emails et des paiements pour vous.

**[Commencer gratuitement → louez.io](https://louez.io)**

</td>
<td align="center" width="50%">

### 🖥️ Auto-hébergé

**Vous voulez le contrôle total ?**

Déployez sur votre propre infrastructure. 100% gratuit, pour toujours.

**[Déployer maintenant ↓](#-déployer-en-30-secondes)**

</td>
</tr>
</table>

---

## 🚀 Déployer en 30 secondes

```bash
docker run -d -p 3000:3000 synapsr/louez
```

**C'est tout.** Ouvrez `http://localhost:3000` et créez votre première boutique.

> 💡 Pour la production avec persistance de la base de données, voir [Configuration Docker complète](#-configuration-docker-complète) ci-dessous.

---

## ✨ Fonctionnalités

### 📊 Tableau de bord puissant

Tout ce dont vous avez besoin pour gérer votre activité de location en un seul endroit.

|     | Fonctionnalité   | Description                                                               |
| :-: | ---------------- | ------------------------------------------------------------------------- |
| 📦  | **Produits**     | Gérez votre inventaire avec images, tarifs flexibles et suivi des stocks  |
| 📅  | **Réservations** | Gérez les demandes, suivez les statuts, organisez les retraits et retours |
| 🗓️  | **Calendrier**   | Vue semaine/mois de toutes vos réservations                               |
| 👥  | **Clients**      | Base de données clients complète avec historique                          |
| 📈  | **Statistiques** | Graphiques de revenus, produits populaires, taux d'occupation             |
| 📄  | **Contrats**     | Génération automatique de contrats PDF                                    |
| ✉️  | **Emails**       | Confirmations, rappels et notifications automatiques                      |
| 👨‍👩‍👧‍👦  | **Équipe**       | Invitez vos collaborateurs avec des rôles et permissions                  |

### 🛍️ Vitrines élégantes

Chaque entreprise de location dispose de sa propre boutique en ligne personnalisée.

- 🎨 **Personnalisation** — Logo, couleurs, thème clair/sombre
- 📱 **Catalogue produits** — Grille filtrable avec disponibilité en temps réel
- 🛒 **Panier** — Sélection des dates, quantités, tarification dynamique
- ✅ **Paiement** — Formulaire client, récapitulatif, acceptation des CGV
- 👤 **Espace client** — Connexion sans mot de passe, suivi des réservations
- 📜 **Pages légales** — CGV et mentions légales éditables

---

## 🐳 Configuration Docker complète

### Démarrage rapide avec Docker Compose

Créez un fichier `docker-compose.yml` :

```yaml
services:
  louez:
    image: synapsr/louez:latest
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=mysql://louez:password@db:3306/louez
      - AUTH_SECRET=changez-moi-avec-une-chaine-de-32-caracteres
      - SMTP_HOST=smtp.exemple.com
      - SMTP_PORT=587
      - SMTP_USER=votre@email.com
      - SMTP_PASSWORD=votre-mot-de-passe
      - EMAIL_FROM=noreply@votredomaine.com
      - NEXT_PUBLIC_APP_URL=https://votredomaine.com
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: mysql:8
    environment:
      - MYSQL_ROOT_PASSWORD=rootpassword
      - MYSQL_DATABASE=louez
      - MYSQL_USER=louez
      - MYSQL_PASSWORD=password
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost']
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  mysql_data:
```

Lancez :

```bash
docker-compose up -d
```

### ☁️ Déploiement en un clic

Fonctionne directement avec vos plateformes préférées :

| Plateforme    | Comment déployer                         |
| ------------- | ---------------------------------------- |
| **EasyPanel** | Ajouter une app Docker → `Synapsr/Louez` |
| **Dokploy**   | Importer depuis Docker Hub               |
| **Coolify**   | Un clic depuis l'image Docker            |
| **Portainer** | Créer un stack depuis compose            |
| **Railway**   | Déployer depuis l'image Docker           |

---

## 🛠️ Installation pour le développement

Vous voulez personnaliser ou contribuer ? Voici comment lancer en local :

```bash
# Cloner le repo
git clone https://github.com/Synapsr/Louez.git
cd louez

# Installer les dépendances
pnpm install

# Configurer l'environnement
cp .env.example .env.local

# Initialiser la base de données
pnpm db:push

# Lancer le serveur de développement
pnpm dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) 🎉

---

## 🏗️ Stack technique

Construit avec des technologies modernes et éprouvées :

|     | Technologie        | Utilisation                           |
| :-: | ------------------ | ------------------------------------- |
| ⚡  | **Next.js 16**     | Framework React avec App Router       |
| 📘  | **TypeScript**     | Développement type-safe               |
| 🎨  | **Tailwind CSS 4** | Styling utility-first                 |
| 🧩  | **shadcn/ui**      | Composants UI élégants                |
| 🗄️  | **Drizzle ORM**    | Requêtes base de données type-safe    |
| 🔐  | **Auth.js**        | Authentification (Google, Magic Link) |
| ✉️  | **React Email**    | Templates d'emails élégants           |
| 📄  | **React PDF**      | Génération de contrats                |
| 🌍  | **next-intl**      | Internationalisation                  |

---

## 📖 Documentation

<details>
<summary><strong>📋 Variables d'environnement</strong></summary>

| Variable              | Requis | Description                          |
| --------------------- | :----: | ------------------------------------ |
| `DATABASE_URL`        |   ✅   | Chaîne de connexion MySQL            |
| `AUTH_SECRET`         |   ✅   | Secret aléatoire (min 32 caractères) |
| `SMTP_HOST`           |   ✅   | Nom d'hôte du serveur SMTP           |
| `SMTP_PORT`           |   ✅   | Port du serveur SMTP                 |
| `SMTP_USER`           |   ✅   | Utilisateur SMTP                     |
| `SMTP_PASSWORD`       |   ✅   | Mot de passe SMTP                    |
| `EMAIL_FROM`          |   ✅   | Adresse email d'envoi                |
| `NEXT_PUBLIC_APP_URL` |   ✅   | URL publique de votre app            |
| `AUTH_GOOGLE_ID`      |        | ID client Google OAuth               |
| `AUTH_GOOGLE_SECRET`  |        | Secret Google OAuth                  |
| `S3_ENDPOINT`         |        | Endpoint S3-compatible               |
| `S3_REGION`           |        | Région S3                            |
| `S3_BUCKET`           |        | Nom du bucket S3                     |
| `S3_ACCESS_KEY`       |        | Clé d'accès S3                       |
| `S3_SECRET_KEY`       |        | Clé secrète S3                       |

</details>

<details>
<summary><strong>📁 Structure du projet</strong></summary>

```
louez/
├── src/
│   ├── app/
│   │   ├── (auth)/           # Connexion, authentification
│   │   ├── (dashboard)/      # Back-office admin
│   │   ├── (storefront)/     # Pages boutique publiques
│   │   └── api/              # Routes API
│   ├── components/
│   │   ├── ui/               # Composants shadcn/ui
│   │   ├── dashboard/        # Composants dashboard
│   │   └── storefront/       # Composants vitrine
│   ├── lib/
│   │   ├── db/               # Schéma base de données
│   │   ├── email/            # Templates email
│   │   └── pdf/              # Génération de contrats
│   └── messages/             # Traductions i18n
└── public/                   # Fichiers statiques
```

</details>

<details>
<summary><strong>🔧 Scripts disponibles</strong></summary>

```bash
pnpm dev          # Lancer le serveur de développement
pnpm build        # Build pour la production
pnpm start        # Lancer le serveur de production
pnpm lint         # Lancer ESLint
pnpm format       # Formater avec Prettier
pnpm db:push      # Synchroniser le schéma avec la base
pnpm db:studio    # Ouvrir Drizzle Studio
pnpm db:generate  # Générer les migrations
pnpm db:migrate   # Exécuter les migrations
```

</details>

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voici comment aider :

- 🐛 **Signaler des bugs** — Vous avez trouvé un problème ? Dites-le nous
- 💡 **Proposer des fonctionnalités** — Une idée ? Ouvrez une discussion
- 🔧 **Soumettre des PRs** — Les contributions de code sont bienvenues
- 📖 **Améliorer la doc** — Aidez les autres à démarrer

### Workflow de développement

```bash
# Fork & clone
git clone https://github.com/VOTRE_USERNAME/louez.git

# Créer une branche
git checkout -b feature/super-fonctionnalite

# Faire les modifications & commit
git commit -m 'Ajouter une super fonctionnalité'

# Push & ouvrir une PR
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

✅ Gratuit pour usage personnel et interne
✅ Modifiez et personnalisez librement
✅ Contributions bienvenues
❌ Ne peut pas être vendu comme service commercial sans accord

---

<div align="center">

### ⭐ Mettez-nous une étoile sur GitHub !

Si Louez aide votre entreprise, montrez votre soutien avec une étoile.

[![Star on GitHub](https://img.shields.io/github/stars/Synapsr/Louez?style=social)](https://github.com/Synapsr/Louez)

---

**Créé avec ❤️ par [Synapsr](https://github.com/synapsr)**

[Signaler un bug](https://github.com/Synapsr/Louez/issues) • [Proposer une fonctionnalité](https://github.com/Synapsr/Louez/discussions) • [Documentation](#-documentation)

</div>
