<div align="right">

🌐 **Language**: [Français](README.fr.md) | **English**

</div>

<div align="center">

# 🏠 Louez

### The Open-Source Equipment Rental Platform

**Stop paying for expensive SaaS. Own your rental business software.**

[![Docker](https://img.shields.io/badge/Docker-synapsr%2Flouez-2496ED?style=for-the-badge&logo=docker)](https://hub.docker.com/r/synapsr/louez)
[![GitHub Stars](https://img.shields.io/github/stars/Synapsr/Louez?style=for-the-badge&logo=github)](https://github.com/Synapsr/Louez)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)

[☁️ Cloud](https://louez.io) • [🚀 Self-Host](#-deploy-in-30-seconds) • [✨ Features](#-features) • [🗺️ Roadmap](ROADMAP.md) • [📋 Changelog](CHANGELOG.md)

</div>

---

## 🎬 Demo

<div align="center">

<video src="demo.mp4" width="100%" autoplay loop muted playsinline></video>

*See Louez in action — from setup to first booking*

</div>

---

## 💡 Why Louez?

Whether you rent cameras, tools, party equipment, or vehicles — **Louez** gives you everything you need to run your rental business professionally.

> 🇫🇷 *"Louez" means "rent" in French — because great software deserves a name that speaks to its purpose.*

| 💸 **No Monthly Fees** | 🎨 **Beautiful Storefronts** | 🔒 **Own Your Data** |
|:----------------------:|:---------------------------:|:--------------------:|
| Self-host for free. No subscriptions, no per-booking fees. | Every store gets a stunning, customizable online catalog. | Your server, your database, your customers. |

| ⚡ **Deploy in Minutes** | 🌍 **Multi-language** | 📱 **Mobile Ready** |
|:-----------------------:|:---------------------:|:-------------------:|
| One Docker command and you're live. | French & English built-in. Add more easily. | Responsive design for all devices. |

---

## ☁️ Cloud or Self-Hosted — You Choose

<table>
<tr>
<td align="center" width="50%">

### ☁️ Louez Cloud

**Don't want to manage servers?**

We handle hosting, updates, backups, emails & payments for you.

**[Get started free → louez.io](https://louez.io)**

</td>
<td align="center" width="50%">

### 🖥️ Self-Hosted

**Want full control?**

Deploy on your own infrastructure. 100% free, forever.

**[Deploy now ↓](#-deploy-in-30-seconds)**

</td>
</tr>
</table>

---

## 🚀 Deploy in 30 Seconds

```bash
docker run -d -p 3000:3000 synapsr/louez
```

**That's it.** Open `http://localhost:3000` and create your first store.

> 💡 For production with database persistence, see [Full Docker Setup](#-full-docker-setup) below.

---

## ✨ Features

### 📊 Powerful Dashboard

Everything you need to manage your rental business in one place.

| | Feature | What it does |
|:-:|---------|-------------|
| 📦 | **Products** | Manage inventory with images, flexible pricing tiers, and stock tracking |
| 📅 | **Reservations** | Handle bookings, track status, manage pickups & returns |
| 🗓️ | **Calendar** | Visual week/month view of all your reservations |
| 👥 | **Customers** | Complete customer database with history |
| 📈 | **Statistics** | Revenue charts, top products, occupancy insights |
| 📄 | **Contracts** | Auto-generated PDF contracts |
| ✉️ | **Emails** | Automated confirmations, reminders & notifications |
| 👨‍👩‍👧‍👦 | **Team** | Invite staff with role-based permissions |

### 🛍️ Stunning Storefronts

Each rental business gets its own branded online store.

- 🎨 **Custom Branding** — Logo, colors, light/dark theme
- 📱 **Product Catalog** — Filterable grid with real-time availability
- 🛒 **Shopping Cart** — Date selection, quantities, dynamic pricing
- ✅ **Checkout** — Customer form, order summary, terms acceptance
- 👤 **Customer Portal** — Passwordless login, reservation tracking
- 📜 **Legal Pages** — Editable terms & conditions

---

## 🐳 Full Docker Setup

### Quick Start with Docker Compose

Create `docker-compose.yml`:

```yaml
services:
  louez:
    image: synapsr/louez:latest
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=mysql://louez:password@db:3306/louez
      - AUTH_SECRET=change-me-to-a-random-32-char-string
      - SMTP_HOST=smtp.example.com
      - SMTP_PORT=587
      - SMTP_USER=your@email.com
      - SMTP_PASSWORD=your-password
      - SMTP_FROM=noreply@yourdomain.com
      - NEXT_PUBLIC_APP_URL=https://yourdomain.com
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
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  mysql_data:
```

Run it:

```bash
docker-compose up -d
```

### ☁️ One-Click Deploy

Works out of the box with your favorite platforms:

| Platform | How to deploy |
|----------|---------------|
| **EasyPanel** | Add Docker app → `synapsr/louez` |
| **Dokploy** | Import from Docker Hub |
| **Coolify** | One-click from Docker image |
| **Portainer** | Create stack from compose |
| **Railway** | Deploy from Docker image |

---

## 🛠️ Development Setup

Want to customize or contribute? Here's how to run locally:

```bash
# Clone the repo
git clone https://github.com/Synapsr/Louez.git
cd louez

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local

# Setup database
pnpm db:push

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

---

## 🏗️ Tech Stack

Built with modern, battle-tested technologies:

| | Technology | Purpose |
|:-:|------------|---------|
| ⚡ | **Next.js 16** | React framework with App Router |
| 📘 | **TypeScript** | Type-safe development |
| 🎨 | **Tailwind CSS 4** | Utility-first styling |
| 🧩 | **shadcn/ui** | Beautiful UI components |
| 🗄️ | **Drizzle ORM** | Type-safe database queries |
| 🔐 | **Auth.js** | Authentication (Google, Magic Link) |
| ✉️ | **React Email** | Beautiful email templates |
| 📄 | **React PDF** | Contract generation |
| 🌍 | **next-intl** | Internationalization |

---

## 📖 Documentation

- [Adding integrations guide](docs/integrations/adding-an-integration.md)

<details>
<summary><strong>📋 Environment Variables</strong></summary>

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DATABASE_URL` | ✅ | MySQL connection string |
| `AUTH_SECRET` | ✅ | Random secret (min 32 chars) |
| `SMTP_HOST` | ✅ | SMTP server hostname |
| `SMTP_PORT` | ✅ | SMTP server port |
| `SMTP_USER` | ✅ | SMTP username |
| `SMTP_PASSWORD` | ✅ | SMTP password |
| `SMTP_FROM` | ✅ | Sender email address |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public URL of your app |
| `AUTH_GOOGLE_ID` | | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | | Google OAuth secret |
| `S3_ENDPOINT` | | S3-compatible endpoint |
| `S3_REGION` | | S3 region |
| `S3_BUCKET` | | S3 bucket name |
| `S3_ACCESS_KEY` | | S3 access key |
| `S3_SECRET_KEY` | | S3 secret key |

</details>

<details>
<summary><strong>📁 Project Structure</strong></summary>

```
louez/
├── src/
│   ├── app/
│   │   ├── (auth)/           # Login, authentication
│   │   ├── (dashboard)/      # Admin back-office
│   │   ├── (storefront)/     # Public store pages
│   │   └── api/              # API routes
│   ├── components/
│   │   ├── ui/               # shadcn/ui components
│   │   ├── dashboard/        # Dashboard components
│   │   └── storefront/       # Storefront components
│   ├── lib/
│   │   ├── db/               # Database schema
│   │   ├── email/            # Email templates
│   │   └── pdf/              # Contract generation
│   └── messages/             # i18n translations
└── public/                   # Static assets
```

</details>

<details>
<summary><strong>🔧 Available Scripts</strong></summary>

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier
pnpm db:push      # Sync schema to database
pnpm db:studio    # Open Drizzle Studio GUI
pnpm db:generate  # Generate migrations
pnpm db:migrate   # Run migrations
```

</details>

---

## 🤝 Contributing

We love contributions! Here's how you can help:

- 🐛 **Report bugs** — Found an issue? Let us know
- 💡 **Suggest features** — Have an idea? Open a discussion
- 🔧 **Submit PRs** — Code contributions welcome
- 📖 **Improve docs** — Help others get started

### Development Workflow

```bash
# Fork & clone
git clone https://github.com/YOUR_USERNAME/louez.git

# Create branch
git checkout -b feature/amazing-feature

# Make changes & commit
git commit -m 'Add amazing feature'

# Push & open PR
git push origin feature/amazing-feature
```

---

## 🔒 Security

Found a vulnerability? Please report it responsibly.

📧 **Email**: [security@louez.io](mailto:security@louez.io)

See [SECURITY.md](SECURITY.md) for our full security policy.

---

## 📄 License

**Apache 2.0 with Commons Clause** — see [LICENSE](LICENSE)

✅ Free for personal and internal use
✅ Modify and customize freely
✅ Contributions welcome
❌ Cannot sell as a commercial service without agreement

---

<div align="center">

### ⭐ Star us on GitHub!

If Louez helps your business, show some love with a star.

[![Star on GitHub](https://img.shields.io/github/stars/Synapsr/Louez?style=social)](https://github.com/Synapsr/Louez)

---

**Built with ❤️ by [Synapsr](https://github.com/synapsr)**

[Report Bug](https://github.com/Synapsr/Louez/issues) • [Request Feature](https://github.com/Synapsr/Louez/discussions) • [Documentation](#-documentation)

</div>
