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

[☁️ Cloud](https://louez.io) • [🚀 Self-Host](#-self-host-in-one-command) • [✨ Features](#-features) • [📋 Changelog](CHANGELOG.md)

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
| One command and you're live — database included. | 8 languages built-in: EN, FR, DE, ES, IT, NL, PL, PT. | Responsive design for all devices. |

---

## ☁️ Cloud or Self-Hosted — You Choose

<table>
<tr>
<td align="center" width="50%">

### ☁️ Louez Cloud

**Don't want to manage servers?**

We handle hosting, updates, backups, emails, payments & the AI assistant for you.

**[Get started free → louez.io](https://louez.io)**

</td>
<td align="center" width="50%">

### 🖥️ Self-Hosted

**Want full control?**

Deploy on your own infrastructure. 100% free, forever.

**[Deploy now ↓](#-self-host-in-one-command)**

</td>
</tr>
</table>

---

## 🚀 Self-Host in One Command

```bash
git clone https://github.com/Synapsr/Louez.git
cd Louez
docker compose up -d
```

**That's it.** Open [http://localhost:3000](http://localhost:3000), create your account, and set up your store. Your storefront goes live at the root of the site; your dashboard lives at `/dashboard`.

The bundled [docker-compose.yml](docker-compose.yml) is a complete, self-contained deployment:

- 🗄️ **Database included** — MySQL runs alongside the app, and the schema installs itself on first boot
- 🖼️ **Image storage included** — a private MinIO bucket, served through the app (no extra ports, no CDN setup)
- 🔑 **No secrets to generate** — an auth secret is created and persisted automatically
- ✉️ **No email server required** — sign in with a password; plug in any SMTP provider later to enable outgoing email
- 🏪 **Single-store mode** — the instance hosts your store, not a SaaS

### Using your own domain

Point a reverse proxy (Caddy, Nginx, Traefik) with TLS at port 3000 and set two variables in a `.env` file next to the compose file:

```bash
NEXT_PUBLIC_APP_URL="https://rentals.example.com"
AUTH_URL="https://rentals.example.com"
```

### One-click platforms

The published image `synapsr/louez` runs in single-store mode by default — provide a MySQL database plus the variables above and it boots on EasyPanel, Dokploy, Coolify, Portainer or Railway. See [.env.example](.env.example) for the full configuration surface (S3 storage, SMTP, Stripe, and more).

### Multi-tenant deployments

Louez can also run as a multi-store platform (the way [louez.io](https://louez.io) does): one dashboard subdomain, one storefront per store subdomain. Set `LOUEZ_MODE=platform` plus the domain variables documented in [.env.example](.env.example).

> ⬆️ **Upgrading an existing multi-store self-host?** Add `LOUEZ_MODE=platform` to your environment to keep subdomain routing — newer images default to single-store mode.

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

### 🤖 AI Assistant

Louez ships a full AI layer that works for your store around the clock.

- 💬 **Storefront AI advisor** — a chat assistant on your storefront that recommends the right gear from your live catalog, checks real availability for the customer's dates, answers questions about your hours and policies, and guides visitors all the way to booking. You brief it in plain language, like a new employee.
- 📞 **AI voice receptionist** — an assistant that answers your store's phone line: it handles questions about products, prices and availability, takes booking *requests* you review from the dashboard, sends the caller an SMS recap, and can hand over to a human. Pick its voice (with audio preview), its language (8 supported), and whether it answers every call or only outside opening hours. You can even get a phone number without leaving the dashboard.
- 🎛️ **One control panel** — configure both assistants, replay conversations and calls, and see which chats turned into reservations.

The AI assistant is available out of the box on **[Louez Cloud](https://louez.io)**. Self-hosters can connect their own AI and telephony providers — the configuration lives in [.env.example](.env.example).

---

## 🛠️ Development Setup

Want to customize or contribute? Here's how to run locally:

```bash
# Clone the repo
git clone https://github.com/Synapsr/Louez.git
cd Louez

# Install dependencies
pnpm install

# Configure environment (creates .env.local at root and in apps/web)
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local

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
| 🧩 | **Base UI** | Accessible UI primitives |
| 🗄️ | **Drizzle ORM** | Type-safe database queries (MySQL) |
| 🔐 | **better-auth** | Authentication (password, email codes, Google) |
| ✉️ | **React Email** | Beautiful email templates |
| 📄 | **React PDF** | Contract generation |
| 🌍 | **next-intl** | Internationalization |

---

## 📖 Documentation

- [Adding integrations guide](docs/integrations/adding-an-integration.md)

<details>
<summary><strong>📋 Environment Variables</strong></summary>

The bundled docker-compose deployment configures all of the required variables for you. For custom deployments:

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DATABASE_URL` | ✅ | MySQL connection string |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public URL of your app |
| `NEXT_PUBLIC_APP_DOMAIN` | ✅ | Public domain of your app |
| `AUTH_URL` | ✅ | URL users sign in from (usually the app URL) |
| `AUTH_SECRET` | | Random secret (auto-generated by the compose deployment) |
| `S3_*` | | S3-compatible storage for images (bundled MinIO in compose) |
| `LOUEZ_MODE` | | `standalone` (default) or `platform` (multi-tenant routing) |
| `SMTP_*` | | Outgoing email — optional; email features disable gracefully |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | | Google sign-in — optional |
| `STRIPE_*` | | Online payments — optional; storefronts fall back to booking requests |

Advanced integrations (AI providers, telephony, SMS, analytics, calendar sync…) are documented in [.env.example](.env.example).

</details>

<details>
<summary><strong>📁 Project Structure</strong></summary>

```
louez/
├── apps/
│   ├── web/               # Next.js app (dashboard + storefronts + API)
│   │   ├── app/           # App Router routes
│   │   ├── components/    # Dashboard & storefront components
│   │   ├── lib/           # Business logic, email, PDF, AI
│   │   └── messages/      # i18n translations (8 languages)
│   └── voice-relay/       # Optional streaming voice bridge (AI receptionist)
├── packages/
│   ├── api/               # oRPC routers & services
│   ├── auth/              # better-auth configuration
│   ├── db/                # Drizzle schema & migrations (MySQL)
│   ├── email/             # Email transport & templates
│   ├── ui/                # Shared UI components
│   └── ...                # types, utils, validations, pdf, config
└── docker/                # Production Dockerfiles & entrypoint
```

</details>

<details>
<summary><strong>🔧 Available Scripts</strong></summary>

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run the linter
pnpm format       # Format the codebase
pnpm type-check   # Type-check the monorepo
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
