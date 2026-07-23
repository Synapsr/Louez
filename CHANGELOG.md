# Changelog

> 🇬🇧 **English** | [🇫🇷 Français](#changelog-fr)

All notable changes to Louez are documented here.

---

## [2.0.0] - July 23, 2026

### 🤖 AI Assistant

Louez now works for your store around the clock — on your storefront and on the phone.

- 💬 **Storefront AI advisor** — A 24/7 chat assistant that recommends the right gear from your live catalog, checks real availability for the customer's dates, answers questions about your hours and policies, and guides visitors all the way to booking. Brief it in plain language, like a new employee.
- 📞 **AI voice receptionist** — An assistant that answers your store's phone line: it handles questions about products, prices and availability, takes booking requests you review from the dashboard, texts an SMS recap, and can transfer to a human. Pick its voice (with audio preview), its language (8 supported), and whether it answers every call or only outside opening hours.
- ☎️ **In-dashboard phone numbers** — Search and provision a real number in a click, or bring your own.
- 🎙️ **Call recording** — Opt-in recording with dashboard replay and a spoken consent notice.
- 🎛️ **One control panel** — Configure both assistants, replay conversations and calls, and see which chats turned into reservations.
- 💳 **Credit wallet** — Usage-based credits with packs, optional auto-recharge, and per-conversation metering (cloud).

### 🚀 One-Command Self-Hosting

Deploying your own instance is now genuinely one command.

- 📦 **`docker compose up -d`** — A complete, self-contained deployment: bundled MySQL and object storage, automatic schema setup on first boot, an auto-generated secret. No SQL, no external services.
- 🏪 **Single-store mode** — The instance hosts your store, served at the root of the site, with the dashboard under `/dashboard`.
- 🔑 **Password sign-in** — Create your admin account without an email server; plug in SMTP later to enable outgoing email.
- 🖼️ **Bundled image storage** — A private MinIO bucket served through the app, or bring your own S3.
- ☁️ **Cloud & multi-tenant unchanged** — Set `LOUEZ_MODE=platform` to keep the subdomain-routed, multi-store behavior.

### ✨ Redesigned Onboarding & Dashboard

- 🧭 **New onboarding flow** — Live previews, a profile step, and a clearer payment-mode choice.
- ⌘ **Command palette** — Redesigned dashboard shell with a `⌘K` command palette.
- 📅 **Reservation editing** — Product-availability tracking and conflict surfacing while editing.
- 🗺️ **Delivery map links** on the calendar.

---

## [1.8.1] - July 9, 2026

### 🚲 Fleet & Unit Inventory

Track and manage every individual unit of your equipment.

- 🏷️ **Unit lifecycle** — Unit status split into lifecycle, downtimes and derived availability.
- 🔧 **Downtime & retirement** — Record repairs, retire units, and edit current downtime from row actions.
- 🩹 **Repair suggestions** — Suggest downtime straight from a return inspection.
- 🚚 **Fleet management UI** — Streamlined unit declaration in the product form, thumbnails in inventory rows.
- 🔒 **Availability hardening** — A single canonical availability core, period-aware capacity, in-transaction unit locking.
- 🐳 **Docker fix** — Empty-database setup now works in the production image.

---

## [1.8.0] - July 2, 2026

### 🎁 Referral Program

Reward your merchants for bringing in others.

- 🔗 **Server-side attribution** across the apex and app, with a qualifying-event reward grant, ledger and clawback.
- 📊 **Referral hub** — "How it works" popover, a sidebar free-reservations gauge, and a referred-side invite banner.

### 💳 Pay-as-you-go Billing

- 💶 **New billing mode** — New stores default to pay-as-you-go; owners can switch between subscription and pay-as-you-go.
- 🎟️ **Free-reservation allowance** and a migration to Stripe Standard.

### 🔔 Notifications & PWA

- 📲 **Web push** notifications for the dashboard.
- 📱 **Installable PWA** — The merchant dashboard installs to the home screen.
- ⏰ **Admin reminders** and a daily digest.

### 🛡️ Tulip Insurance

- 🤝 **Tulip integration** — Insurance options in reservation management, quote previews, and legacy backfill.

### 📈 Analytics

- 📊 **Product event tracking** across dashboard and storefront, with consent-exempt storefront tracking.

---

## [1.7.0] - March 17, 2026

### 🤖 Dashboard AI Chat

- 💬 **AI chat assistant** in the dashboard, with conversation history and admin notifications.

### 🧩 Integrations & Embedding

- 🔌 **MCP server** — API-key-authenticated MCP server with a dashboard UI.
- 🗓️ **Embeddable widget** — A date picker / calendar you can embed on external websites, with business hours and delivery trust badges.

### 💶 Pricing & Delivery

- 📈 **Seasonal pricing** — Inline editing with multi-period calculations and a pricing-curve preview.
- 🕐 **Multiple time ranges per day** in business hours.
- 🚚 **Leg-based delivery model** with a different return-address option.
- 🏷️ **Discount display** — Show the highest discount on product cards.

### 📤 Data & Payments

- 📁 **Data export** for payments, reservations, and products.
- 💳 **Intermediary payment page** to avoid 24h Stripe session expiry.

---

## [1.6.0] - January 29, 2026

### 🔍 Inventory Inspection (Equipment Condition Reports)

Complete inspection system for documenting equipment condition at pickup and return.

- 📋 **Inspection templates** — Customizable checklists at store, category, or product level
- 📷 **Photo documentation** — Capture unlimited photos with thumbnails and captions
- ✍️ **Digital signatures** — Customer signature capture with IP tracking
- 📊 **Condition ratings** — 4-level scale (Excellent, Good, Fair, Damaged)
- ⚠️ **Damage tracking** — Flag damage, add descriptions and cost estimates
- 🔄 **Departure vs Return comparison** — Side-by-side view showing condition changes
- 📄 **PDF reports** — Professional inspection documents (État des Lieux)
- ⚙️ **Configurable modes** — Optional, Recommended, or Required inspections
- 🌍 **Full i18n** — All 8 languages supported

### 🏪 Multi-Store Dashboard

Manage all your stores from one place.

- 📊 **Aggregated metrics** — Total revenue, reservations, customers across all stores
- 📈 **Store comparison** — Performance table with plan badges and growth indicators
- 📉 **Revenue trends** — Chart comparing stores over time
- ⚠️ **Plan limits alerts** — Warnings when stores approach their limits
- 🔗 **Quick access** — Multi-store link in store switcher dropdown

### 🚚 Delivery System

Flexible delivery options for your customers.

- 🎛️ **Three modes** — Optional (customer chooses), required, or included (free)
- 📍 **Distance pricing** — Calculate fees based on Haversine formula
- 🗺️ **Google Places** — Address autocomplete with geocoding
- 🔒 **Server validation** — Secure fee recalculation prevents manipulation
- 📄 **Confirmation display** — Delivery address shown on confirmation page

### 💳 Payment Enhancements

More flexibility for collecting payments.

- 📨 **Payment requests** — Send payment links via email/SMS from dashboard
- 🔐 **Deposit authorization** — Hold funds on customer cards without charging (Stripe manual capture)
- 📊 **Configurable deposits** — Set deposit percentage (10-100%) for online payments
- 🔓 **Auto-login** — Customers automatically logged in after payment completion

### 📦 Unit Tracking

Track individual items with unique identifiers.

- 🏷️ **Unit identifiers** — Serial numbers, license plates, or custom IDs
- 📋 **Assignment selector** — Assign specific units to reservations
- 📄 **PDF contracts** — Assigned units shown in rental contracts
- 🔢 **Quantity management** — Pre-create slots based on product quantity

### ✨ Settings & UX

- 💾 **Floating save bar** — Sticky pill appears when forms have unsaved changes
- 🎨 **Smooth animations** — Backdrop blur and subtle transitions
- ♿ **Accessibility** — ARIA attributes and motion-reduce support
- 🔄 **Reset functionality** — Discard changes with one click

### 💰 Subscription Updates

- 💶 **New pricing** — Pro 49€/month, Ultra 159€/month
- 🧾 **Prices HT** — Display excluding tax with Stripe automatic tax
- 🎫 **Early bird removed** — Discount offer concluded

### 📅 Calendar Improvements

- 🔝 **Smart sorting** — Products with active reservations appear first
- 📊 **Usage-based** — Sorted by reserved quantity for quick visibility

### 🛠️ Developer Tools

- 🌱 **Database seed script** — `pnpm db:seed --email=dev@example.com`
- 🏪 **4 test stores** — Different configurations, pricing modes, plans
- 📦 **Realistic data** — Products, customers, reservations, payments, analytics
- 🔒 **Production safe** — Script refuses to run in production

### 🔧 Other Improvements

- 📏 **Unlimited pricing tiers** — Removed 5-tier limit on long-duration pricing
- 👤 **PostHog identification** — User attribution for session replays
- 🏢 **Business customers** — Company info displayed on reservation detail

### 🐛 Bug Fixes

**Security & Validation**

- 🛡️ NaN validation and GPS coordinate range checks in delivery
- 🔒 httpOnly cookie for store selection (XSS protection)
- ⚡ Parallelized multi-store metrics queries (N+1 fix)
- 💰 Delivery fees rounded to 2 decimal places

**Email Compatibility**

- 🖼️ SVG logos converted to PNG (Gmail, Outlook, Yahoo)
- 📎 CID attachments instead of data: URIs

**Internationalization**

- 🌍 50+ missing translation keys added across 8 languages
- 📍 Fixed misplaced paths (accessories, checkout, confirmation)
- 🔤 Hardcoded French strings replaced with i18n calls

**Stripe**

- 💳 Persist customer ID on creation (prevents duplicates)

**Routing**

- 🔗 Fixed double-slug issue on subdomain routing
- 🔀 Absolute URLs for all server-side redirects

**UI**

- 📐 Reduced sidebar spacing for small screens
- 🎨 Improved AlertDialog button styling

### 🗃️ Database Migrations

- `0020_closed_impossible_man.sql` — Unit tracking tables
- `0021_add_delivery_fields.sql` — Delivery fields on reservations

---

## [1.5.0] - January 27, 2026

### 🔒 Security Hardening

Comprehensive fixes from a full security audit.

- 🛡️ **Content Security Policy** — Strict CSP headers for all external services
- 🚫 **Open redirect protection** — Login callback URL validation
- 🔍 **Input validation** — IP extraction, validation, and anonymization utilities
- 🖼️ **Image whitelisting** — MIME type checks, size limits, path traversal prevention
- 🔐 **Action hardening** — Parameter validation across all server actions

### 📦 S3 Image Uploads

Secure, scalable image storage replacing base64.

- ☁️ **S3 upload endpoint** — Authenticated, validated, sanitized file uploads
- 🚫 **Base64 blocked** — All schemas reject data URIs, accept only S3 URLs
- 📊 **Progress indicators** — Real-time upload feedback in all forms
- 🔒 **Defense in depth** — Store membership verification, MIME whitelisting

### 📊 PostHog Analytics

Product analytics for data-driven decisions.

- 📈 **Server-side tracking** — Event utilities for backend operations
- 🖥️ **Client-side SPA tracking** — Automatic pageview capture
- 🏪 **Full coverage** — Dashboard and storefront instrumented
- 🔒 **CSP compatible** — Reverse proxy support for strict environments

### 📍 Google Places API

Smart address autocomplete for store locations.

- 🔍 **Autocomplete** — Real-time address suggestions via Places API
- 🗺️ **Geocoding** — Automatic lat/lng extraction from selected address
- 🧩 **Integrated components** — Updated AddressInput and AddressMapModal

### 🚀 Onboarding Overhaul

A smoother, localized first-run experience.

- 🌍 **Country & currency** — Auto-detected from browser locale
- 🕐 **Timezone derivation** — Automatically calculated from country
- 📧 **Dynamic email locale** — Replaces hardcoded French locale
- ✏️ **Slug editing** — Improved generation and editing UX
- 🎨 **Theme simplification** — Light/dark only
- ✅ **Validation fixes** — Translated schemas, error translation, logo upload fix

### 🔔 Discord Admin Notifications

Real-time platform monitoring for operators.

- 📡 **17 event types** — Auth, subscriptions, payments, stores, reservations, settings
- ⚡ **Fire-and-forget** — Never blocks caller operations
- 🏷️ **Rich formatting** — Store links, plan badges, event context
- 🔇 **Clean messages** — Link embed suppression

### 💰 Pricing Tiers Editor

More intuitive pricing configuration.

- 🎯 **Target price input** — Set desired price, auto-calculate discount
- 💵 **Total cost input** — Set total cost, derive per-unit price
- 📐 **Strict tier enforcement** — Snap durations to defined tiers
- 🔢 **6-decimal precision** — Accurate discount calculations
- 👁️ **Price preview** — See prices at common durations (1, 3, 7, 14, 30 days)

### 🎁 Referral System

Word-of-mouth growth with tracking and rewards.

- 🔗 **Unique codes** — `LOUEZ-{nanoid}` per store, cookie-persisted
- 📊 **Dashboard page** — Stats cards, referrals table with plan/status badges
- 🔄 **Tracking** — Referred stores linked to referrer during onboarding
- 🎁 **Rewards** — 3 free Ultra months for successful referrals

### ⚙️ Settings Redesign

Unified settings experience with vertical navigation.

- 📋 **Sidebar navigation** — Desktop sidebar with icons, mobile dropdown
- 🛡️ **Admin settings** — Trial days configuration (platform admins only)
- ⏱️ **minRentalHours** — Clear hours-based minimum rental duration

### 🎨 Dark Logo

Theme-aware branding for documents.

- 🌓 **Dark logo upload** — Separate logo for light backgrounds
- 🧠 **Smart resolution** — Automatic logo selection per context
- 📄 **Applied everywhere** — 14 email templates, PDF contracts, reminders

### ✨ Other Improvements

- 🔒 **CSP updates** — Rules for Gleap, PostHog, Google, S3 providers
- 🗃️ **Database migrations** — Discount precision, strict tiers, trial days, referrals
- 🌍 **8 languages updated** — All new features translated (fr, en, de, es, it, nl, pl, pt)
- 🐛 **Bug fixes** — Decimal input on Firefox, currency symbol alignment, tax cache

---

## [1.4.0] - January 20, 2026

### 🔔 Notification Center

A unified hub to manage all your customer communications.

- 📬 **Multi-channel** — Send via Email, SMS, or Discord from one place
- ✏️ **Custom templates** — Personalize messages for every event
- 👁️ **Live preview** — See exactly what customers will receive
- 🌍 **Full i18n** — Templates adapt to customer language

### ⏰ Smart Reminders

Never let a customer forget their booking.

- 📤 **Pickup reminders** — Automatic notifications before rental starts
- 📥 **Return reminders** — Gentle nudges before items are due back
- ⚙️ **Configurable timing** — Set hours in advance per event type

### 📅 Calendar Superpowers

New views to manage your fleet at a glance.

- 📊 **Timeline view** — See all reservations on a horizontal timeline
- 📦 **Products view** — Track each unit's availability individually
- 🗓️ **Better month view** — Multi-day reservations display beautifully
- 🎨 **Visual polish** — Color-coded bars and smooth interactions

### 🏠 Redesigned Dashboard

A smarter home that adapts to your business.

- ✨ **Adaptive UX** — Different layouts for new, growing, and active stores
- 📋 **Floating checklist** — Setup progress always visible
- 📱 **QR code & sharing** — One-click share your storefront
- 👋 **Personal greetings** — Time-aware welcome messages
- 🎨 **Animated gradient** — Subtle, modern visual touch

### ✨ Other Improvements

- 🎨 **New favicon** — Fresh blue icon for browser tabs
- 🔵 **Updated brand color** — Refined primary blue (#2b62ef)
- 📊 **Better analytics** — Improved Umami & Gleap integration
- 💬 **SMS fixes** — Proper accents and special characters

---

## [1.3.0] - January 17, 2026

### 💳 Online Payments

Accept payments directly on your storefront with **Stripe Connect**.

- 🔗 **Stripe Connect** — Seamless onboarding for cloud and self-hosted
- 🔒 **Deposit holds** — Authorize without charging, release or capture later
- 📊 **Payment tracking** — Real-time status in reservation details
- ✨ **Instant access** — Magic links for customers to track their booking

### 📱 SMS Notifications

Reach your customers directly on their phones.

- 📤 **SMS Partner** — Send SMS notifications (more providers coming)
- ⏰ **Reminders** — Automatic pickup & return reminders
- 🔗 **Access links** — Send reservation links via SMS
- 📈 **Plan limits** — SMS quotas based on subscription

### 🛒 Accessories & Upsells

Boost your average order value.

- 🔗 **Related products** — Link accessories to main items
- 💡 **Smart suggestions** — Display on product pages
- ⚡ **One-click add** — Quick add to cart

### 🧾 Tax Management

Handle taxes your way.

- 📊 **Custom rates** — Set your VAT or sales tax
- 🏷️ **Per-product** — Override rates for specific items
- 👁️ **Display modes** — Show TTC or HT prices
- 📄 **Compliant invoices** — Tax breakdown on documents

### ✏️ Reservation Editing

Modify bookings without starting over.

- 📅 **Change dates** — Adjust rental periods
- ➕ **Add items** — Include extra products or services
- 💰 **Price adjustments** — Manual discounts or surcharges
- ⚠️ **Conflict warnings** — See availability issues before saving

### 🏢 Business Customers

Better B2B support.

- 🏛️ **Company profiles** — Store business details & VAT numbers
- 📍 **Billing address** — Separate from store location
- 👔 **Customer types** — Distinguish individual vs business

### 📅 Calendar Export

Sync with your favorite calendar.

- 📆 **ICS feed** — Google, Apple, Outlook compatible
- 🔄 **Live sync** — Auto-updates as bookings change
- 🔑 **Secure tokens** — Regenerate anytime

### ✨ Other Improvements

- 📊 **Umami analytics** — Privacy-friendly tracking
- 🐳 **Auto migrations** — Database updates on Docker startup
- 💀 **Loading skeletons** — Smoother page loads
- 🎨 **Redesigned UX** — Better reservation details, smarter contrast

---

## [1.2.0] - January 15, 2026

### 💼 SaaS Subscriptions

Louez Cloud now supports paid plans.

- 📊 **Plan limits** — Products, reservations, customers per plan
- ⬆️ **Upgrade prompts** — Clear modals when approaching limits
- 💳 **Billing portal** — Manage subscription from settings
- 🌍 **Multi-currency** — EUR, USD, GBP supported
- 🎉 **Early bird** — Launch discount displayed

### 🛍️ Storefront Improvements

- 👁️ **Product preview** — Quick view without leaving catalog
- 📅 **Inline date picker** — Select dates in catalog header
- 🖼️ **Store favicon** — Your logo as browser tab icon

### 👥 Team Management

- 👤 **Collaborator limits** — Team size based on plan
- ⚙️ **Unified settings** — Everything in one place

### ✨ Quality of Life

- 🖱️ **Drag & drop** — Upload images by dragging
- ⏰ **Business hours** — Enabled by default
- 🖼️ **Better logos** — SVG to PNG for PDFs

---

## [1.1.0] - January 15, 2026

### 🌍 6 New Languages

Louez now speaks **8 languages**!

- 🇮🇹 Italian
- 🇳🇱 Dutch
- 🇵🇹 Portuguese
- 🇩🇪 German
- 🇪🇸 Spanish
- 🇵🇱 Polish

### 🚀 Easier Setup

- 🔧 **Auto database setup** — Fresh installs configure themselves
- ✉️ **Modern magic links** — Beautiful, branded emails
- 🔐 **OAuth improvements** — Better errors, auto account linking

### ✨ Quality of Life

- ⏰ **Advance notice** — Date pickers respect your settings
- 🖼️ **Product thumbnails** — Images in manual reservations
- 🌙 **Dark mode charts** — Statistics look great everywhere
- 💱 **Multi-currency** — Use your store's currency

---

## [1.0.0] - January 14, 2026

### 🎉 Initial Release

The first public release of Louez!

**Core Features**

- 🏢 **Multi-tenant** — Multiple stores, one installation
- 📦 **Products** — Catalog, categories, pricing tiers
- 📅 **Reservations** — Full workflow management
- 👥 **Customers** — Database with rental history
- ✉️ **Emails** — Automated notifications
- 📄 **PDF contracts** — Professional agreements
- 🎨 **Storefronts** — Branded booking sites
- 👥 **Teams** — Role-based permissions
- 📊 **Statistics** — Revenue & insights
- 🌍 **i18n** — French & English

---

<div align="center">

_For upgrade instructions, see the [documentation](https://louez.io/docs)._

</div>

---

---

<a id="changelog-fr"></a>

# Changelog (Français)

> [🇬🇧 English](#changelog) | 🇫🇷 **Français**

Toutes les évolutions notables de Louez sont documentées ici.

---

## [2.0.0] - 23 juillet 2026

### 🤖 Assistant IA

Louez travaille désormais pour votre boutique en continu — sur votre vitrine comme au téléphone.

- 💬 **Conseiller IA sur la vitrine** — Un assistant de chat 24/7 qui recommande le bon matériel depuis votre catalogue en direct, vérifie la disponibilité réelle aux dates du client, répond aux questions sur vos horaires et conditions, et accompagne les visiteurs jusqu'à la réservation. Briefez-le en langage naturel, comme un nouvel employé.
- 📞 **Réceptionniste vocal IA** — Un assistant qui répond à la ligne téléphonique de votre boutique : produits, prix et disponibilité, prise de demandes de réservation que vous validez depuis le tableau de bord, récapitulatif par SMS, transfert vers un humain. Choisissez sa voix (avec pré-écoute), sa langue (8 disponibles), et s'il répond à tous les appels ou seulement hors horaires.
- ☎️ **Numéros de téléphone dans le tableau de bord** — Recherchez et provisionnez un vrai numéro en un clic, ou branchez le vôtre.
- 🎙️ **Enregistrement des appels** — Optionnel, avec réécoute dans le tableau de bord et annonce de consentement.
- 🎛️ **Un seul panneau de contrôle** — Configurez les deux assistants, réécoutez conversations et appels, voyez lesquels ont mené à une réservation.
- 💳 **Portefeuille de crédits** — Crédits à l'usage, packs, recharge automatique optionnelle, décompte par conversation (cloud).

### 🚀 Auto-hébergement en une commande

Déployer votre propre instance tient désormais vraiment en une commande.

- 📦 **`docker compose up -d`** — Un déploiement complet et autonome : MySQL et stockage objet embarqués, schéma installé automatiquement au premier démarrage, secret généré. Pas de SQL, pas de service externe.
- 🏪 **Mode boutique unique** — L'instance héberge votre boutique, servie à la racine du site, le tableau de bord sous `/dashboard`.
- 🔑 **Connexion par mot de passe** — Créez votre compte admin sans serveur email ; branchez un SMTP plus tard pour les emails sortants.
- 🖼️ **Stockage d'images inclus** — Un bucket MinIO privé servi par l'application, ou votre propre S3.
- ☁️ **Cloud & multi-boutiques inchangés** — Posez `LOUEZ_MODE=platform` pour conserver le routage par sous-domaines et le multi-boutiques.

### ✨ Onboarding & tableau de bord repensés

- 🧭 **Nouveau parcours d'onboarding** — Aperçus en direct, étape de profil, choix du mode de paiement plus clair.
- ⌘ **Palette de commandes** — Nouveau shell du tableau de bord avec palette `⌘K`.
- 📅 **Édition des réservations** — Suivi de disponibilité produit et détection des conflits pendant l'édition.
- 🗺️ **Liens carte de livraison** sur le calendrier.

---

## [1.8.1] - 9 juillet 2026

### 🚲 Inventaire par unité & flotte

Suivez et gérez chaque unité individuelle de votre matériel.

- 🏷️ **Cycle de vie des unités** — Statut séparé en cycle de vie, indisponibilités et disponibilité dérivée.
- 🔧 **Indisponibilité & retrait** — Enregistrez les réparations, retirez des unités, éditez l'indisponibilité en cours depuis les actions de ligne.
- 🩹 **Suggestions de réparation** — Proposez une indisponibilité directement depuis une inspection de retour.
- 🚚 **Interface de gestion de flotte** — Déclaration d'unités simplifiée dans la fiche produit, miniatures dans l'inventaire.
- 🔒 **Fiabilisation de la disponibilité** — Un cœur de disponibilité canonique unique, capacité sensible aux périodes, verrouillage transactionnel des unités.
- 🐳 **Correctif Docker** — L'installation sur base vierge fonctionne dans l'image de production.

---

## [1.8.0] - 2 juillet 2026

### 🎁 Programme de parrainage

Récompensez vos loueurs qui en amènent d'autres.

- 🔗 **Attribution côté serveur** sur l'apex et l'app, avec récompense sur événement qualifiant, registre et clawback.
- 📊 **Hub de parrainage** — Popover « comment ça marche », jauge de réservations offertes dans la sidebar, bannière d'invitation côté filleul.

### 💳 Facturation à l'usage

- 💶 **Nouveau mode de facturation** — Les nouvelles boutiques démarrent en pay-as-you-go ; bascule possible entre abonnement et à l'usage.
- 🎟️ **Réservations offertes** et migration vers Stripe Standard.

### 🔔 Notifications & PWA

- 📲 **Notifications web push** pour le tableau de bord.
- 📱 **PWA installable** — Le tableau de bord s'installe sur l'écran d'accueil.
- ⏰ **Rappels admin** et digest quotidien.

### 🛡️ Assurance Tulip

- 🤝 **Intégration Tulip** — Options d'assurance dans la gestion des réservations, aperçus de devis, backfill des intégrations existantes.

### 📈 Analytics

- 📊 **Suivi d'événements produit** sur le tableau de bord et la vitrine, avec tracking vitrine exempté de consentement.

---

## [1.7.0] - 17 mars 2026

### 🤖 Chat IA du tableau de bord

- 💬 **Assistant de chat IA** dans le tableau de bord, avec historique des conversations et notifications admin.

### 🧩 Intégrations & intégration web

- 🔌 **Serveur MCP** — Serveur MCP authentifié par clé API avec interface dans le tableau de bord.
- 🗓️ **Widget intégrable** — Un sélecteur de dates / calendrier à intégrer sur des sites externes, avec horaires d'ouverture et badges de confiance livraison.

### 💶 Tarification & livraison

- 📈 **Tarifs saisonniers** — Édition en ligne avec calculs multi-périodes et aperçu de courbe tarifaire.
- 🕐 **Plusieurs plages horaires par jour** dans les horaires d'ouverture.
- 🚚 **Modèle de livraison par tronçons** avec option d'adresse de retour différente.
- 🏷️ **Affichage des remises** — Montrez la remise la plus élevée sur les cartes produit.

### 📤 Données & paiements

- 📁 **Export de données** pour paiements, réservations et produits.
- 💳 **Page de paiement intermédiaire** pour éviter l'expiration des sessions Stripe à 24h.

---

## [1.6.0] - 29 janvier 2026

### 🔍 États des Lieux (Rapports de Condition)

Système complet d'inspection pour documenter l'état des équipements au retrait et au retour.

- 📋 **Modèles d'inspection** — Checklists personnalisables par boutique, catégorie ou produit
- 📷 **Documentation photo** — Capturez des photos illimitées avec miniatures et légendes
- ✍️ **Signatures numériques** — Capture de signature client avec suivi IP
- 📊 **Notes de condition** — Échelle à 4 niveaux (Excellent, Bon, Correct, Endommagé)
- ⚠️ **Suivi des dommages** — Signalez les dégâts, ajoutez descriptions et estimations de coût
- 🔄 **Comparaison Départ vs Retour** — Vue côte à côte montrant les changements d'état
- 📄 **Rapports PDF** — Documents d'inspection professionnels
- ⚙️ **Modes configurables** — Inspections Optionnelles, Recommandées ou Obligatoires
- 🌍 **i18n complet** — Les 8 langues supportées

### 🏪 Dashboard Multi-Boutiques

Gérez toutes vos boutiques depuis un seul endroit.

- 📊 **Métriques agrégées** — Chiffre d'affaires, réservations, clients sur toutes les boutiques
- 📈 **Comparaison** — Tableau de performance avec badges plan et indicateurs de croissance
- 📉 **Tendances revenus** — Graphique comparant les boutiques dans le temps
- ⚠️ **Alertes limites** — Avertissements quand les boutiques approchent leurs limites
- 🔗 **Accès rapide** — Lien multi-boutiques dans le sélecteur de boutique

### 🚚 Système de Livraison

Options de livraison flexibles pour vos clients.

- 🎛️ **Trois modes** — Optionnel (choix client), obligatoire, ou inclus (gratuit)
- 📍 **Tarification distance** — Calcul des frais basé sur la formule de Haversine
- 🗺️ **Google Places** — Autocomplétion d'adresse avec géocodage
- 🔒 **Validation serveur** — Recalcul sécurisé des frais empêche la manipulation
- 📄 **Affichage confirmation** — Adresse de livraison affichée sur la page de confirmation

### 💳 Améliorations Paiements

Plus de flexibilité pour collecter les paiements.

- 📨 **Demandes de paiement** — Envoyez des liens de paiement par email/SMS depuis le dashboard
- 🔐 **Autorisation de caution** — Bloquez des fonds sur la carte client sans débiter (capture manuelle Stripe)
- 📊 **Acomptes configurables** — Définissez le pourcentage d'acompte (10-100%) pour les paiements en ligne
- 🔓 **Connexion auto** — Clients automatiquement connectés après paiement

### 📦 Suivi des Unités

Suivez les articles individuels avec des identifiants uniques.

- 🏷️ **Identifiants d'unité** — Numéros de série, plaques d'immatriculation, ou IDs personnalisés
- 📋 **Sélecteur d'assignation** — Assignez des unités spécifiques aux réservations
- 📄 **Contrats PDF** — Unités assignées affichées dans les contrats de location
- 🔢 **Gestion quantité** — Pré-création des slots selon la quantité produit

### ✨ Paramètres & UX

- 💾 **Barre de sauvegarde flottante** — Pilule sticky qui apparaît avec des modifications non sauvegardées
- 🎨 **Animations fluides** — Flou d'arrière-plan et transitions subtiles
- ♿ **Accessibilité** — Attributs ARIA et support motion-reduce
- 🔄 **Réinitialisation** — Annulez les modifications en un clic

### 💰 Mises à jour Abonnements

- 💶 **Nouveaux tarifs** — Pro 49€/mois, Ultra 159€/mois
- 🧾 **Prix HT** — Affichage hors taxes avec calcul automatique Stripe
- 🎫 **Early bird terminé** — Offre de réduction conclue

### 📅 Améliorations Calendrier

- 🔝 **Tri intelligent** — Les produits avec réservations actives apparaissent en premier
- 📊 **Basé sur l'usage** — Trié par quantité réservée pour visibilité rapide

### 🛠️ Outils Développeur

- 🌱 **Script de seed BDD** — `pnpm db:seed --email=dev@example.com`
- 🏪 **4 boutiques test** — Différentes configurations, modes tarifaires, plans
- 📦 **Données réalistes** — Produits, clients, réservations, paiements, analytics
- 🔒 **Sécurité production** — Le script refuse de s'exécuter en production

### 🔧 Autres améliorations

- 📏 **Paliers illimités** — Suppression de la limite à 5 paliers pour les longues durées
- 👤 **Identification PostHog** — Attribution utilisateur pour les replays de session
- 🏢 **Clients professionnels** — Infos entreprise affichées sur le détail réservation

### 🐛 Corrections de bugs

**Sécurité & Validation**

- 🛡️ Validation NaN et plages de coordonnées GPS pour la livraison
- 🔒 Cookie httpOnly pour la sélection de boutique (protection XSS)
- ⚡ Requêtes multi-boutiques parallélisées (fix N+1)
- 💰 Frais de livraison arrondis à 2 décimales

**Compatibilité Email**

- 🖼️ Logos SVG convertis en PNG (Gmail, Outlook, Yahoo)
- 📎 Pièces jointes CID au lieu des data: URIs

**Internationalisation**

- 🌍 50+ clés de traduction manquantes ajoutées sur 8 langues
- 📍 Chemins mal placés corrigés (accessoires, checkout, confirmation)
- 🔤 Chaînes françaises codées en dur remplacées par des appels i18n

**Stripe**

- 💳 Persistance de l'ID client à la création (évite les doublons)

**Routage**

- 🔗 Correction du problème de double-slug sur le routage par sous-domaine
- 🔀 URLs absolues pour toutes les redirections côté serveur

**Interface**

- 📐 Espacement sidebar réduit pour petits écrans
- 🎨 Style des boutons AlertDialog amélioré

### 🗃️ Migrations Base de données

- `0020_closed_impossible_man.sql` — Tables de suivi d'unités
- `0021_add_delivery_fields.sql` — Champs livraison sur les réservations

---

## [1.5.0] - 27 janvier 2026

### 🔒 Renforcement Sécurité

Corrections complètes suite à un audit de sécurité.

- 🛡️ **Content Security Policy** — En-têtes CSP stricts pour tous les services externes
- 🚫 **Protection redirections** — Validation des URL de callback login
- 🔍 **Validation des entrées** — Extraction, validation et anonymisation des IP
- 🖼️ **Whitelist images** — Vérification MIME, limites de taille, prévention path traversal
- 🔐 **Actions renforcées** — Validation des paramètres sur toutes les actions serveur

### 📦 Upload S3

Stockage d'images sécurisé et scalable, remplaçant le base64.

- ☁️ **Endpoint d'upload S3** — Uploads authentifiés, validés et nettoyés
- 🚫 **Base64 bloqué** — Tous les schémas rejettent les data URIs, acceptent uniquement les URLs S3
- 📊 **Indicateurs de progression** — Feedback en temps réel dans tous les formulaires
- 🔒 **Défense en profondeur** — Vérification d'appartenance au store, whitelist MIME

### 📊 Analytics PostHog

Analytics produit pour des décisions data-driven.

- 📈 **Tracking côté serveur** — Utilitaires d'événements backend
- 🖥️ **Tracking SPA côté client** — Capture automatique des pages vues
- 🏪 **Couverture complète** — Dashboard et vitrine instrumentés
- 🔒 **Compatible CSP** — Support reverse proxy pour environnements stricts

### 📍 Google Places API

Autocomplétion d'adresses intelligente pour les boutiques.

- 🔍 **Autocomplétion** — Suggestions d'adresses en temps réel via Places API
- 🗺️ **Géocodage** — Extraction automatique lat/lng depuis l'adresse sélectionnée
- 🧩 **Composants intégrés** — AddressInput et AddressMapModal mis à jour

### 🚀 Onboarding Repensé

Une première expérience plus fluide et localisée.

- 🌍 **Pays & devise** — Détection automatique depuis la locale du navigateur
- 🕐 **Fuseau horaire** — Calculé automatiquement depuis le pays
- 📧 **Locale email dynamique** — Remplace la locale française codée en dur
- ✏️ **Édition du slug** — Génération et édition améliorées
- 🎨 **Thèmes simplifiés** — Clair/sombre uniquement
- ✅ **Corrections validation** — Schémas traduits, traduction des erreurs, fix upload logo

### 🔔 Notifications Discord Admin

Monitoring plateforme en temps réel pour les opérateurs.

- 📡 **17 types d'événements** — Auth, abonnements, paiements, boutiques, réservations, paramètres
- ⚡ **Fire-and-forget** — Ne bloque jamais l'appelant
- 🏷️ **Formatage riche** — Liens boutique, badges plan, contexte événement
- 🔇 **Messages propres** — Suppression des previews de liens

### 💰 Éditeur de Paliers Tarifaires

Configuration des prix plus intuitive.

- 🎯 **Prix cible** — Définissez le prix souhaité, calcul auto de la remise
- 💵 **Coût total** — Définissez le coût total, déduction du prix unitaire
- 📐 **Paliers stricts** — Arrondissement des durées aux paliers définis
- 🔢 **Précision 6 décimales** — Calculs de remise précis
- 👁️ **Aperçu des prix** — Visualisez les prix aux durées courantes (1, 3, 7, 14, 30 jours)

### 🎁 Système de Parrainage

Croissance par le bouche-à-oreille avec suivi et récompenses.

- 🔗 **Codes uniques** — `LOUEZ-{nanoid}` par boutique, persisté par cookie
- 📊 **Page dashboard** — Cartes stats, tableau des filleuls avec badges plan/statut
- 🔄 **Tracking** — Boutiques parrainées liées au parrain lors de l'inscription
- 🎁 **Récompenses** — 3 mois Ultra gratuits pour les parrainages réussis

### ⚙️ Paramètres Repensés

Expérience unifiée avec navigation verticale.

- 📋 **Navigation sidebar** — Barre latérale avec icônes en desktop, dropdown en mobile
- 🛡️ **Paramètres admin** — Configuration des jours d'essai (admins plateforme uniquement)
- ⏱️ **minRentalHours** — Durée minimale de location en heures, claire et explicite

### 🎨 Logo Sombre

Branding adapté au thème pour les documents.

- 🌓 **Upload logo sombre** — Logo séparé pour les fonds clairs
- 🧠 **Résolution intelligente** — Sélection automatique du logo selon le contexte
- 📄 **Appliqué partout** — 14 templates email, contrats PDF, rappels

### ✨ Autres améliorations

- 🔒 **Mises à jour CSP** — Règles pour Gleap, PostHog, Google, fournisseurs S3
- 🗃️ **Migrations BDD** — Précision remises, paliers stricts, jours d'essai, parrainages
- 🌍 **8 langues mises à jour** — Toutes les fonctionnalités traduites (fr, en, de, es, it, nl, pl, pt)
- 🐛 **Corrections de bugs** — Input décimal Firefox, alignement symbole devise, cache taxes

---

## [1.4.0] - 20 janvier 2026

### 🔔 Centre de Notifications

Un hub unifié pour gérer toutes vos communications clients.

- 📬 **Multi-canal** — Envoyez par Email, SMS ou Discord depuis un seul endroit
- ✏️ **Templates personnalisables** — Personnalisez les messages pour chaque événement
- 👁️ **Aperçu en direct** — Visualisez exactement ce que vos clients recevront
- 🌍 **i18n complet** — Les templates s'adaptent à la langue du client

### ⏰ Rappels Automatiques

Ne laissez plus vos clients oublier leur réservation.

- 📤 **Rappels de retrait** — Notifications automatiques avant le début de location
- 📥 **Rappels de retour** — Rappels avant la date de retour prévue
- ⚙️ **Timing configurable** — Définissez le délai en heures par type d'événement

### 📅 Calendrier Enrichi

De nouvelles vues pour gérer votre flotte d'un coup d'œil.

- 📊 **Vue Timeline** — Visualisez toutes les réservations sur une frise horizontale
- 📦 **Vue Produits** — Suivez la disponibilité de chaque unité individuellement
- 🗓️ **Vue mois améliorée** — Les réservations multi-jours s'affichent élégamment
- 🎨 **Polish visuel** — Barres colorées et interactions fluides

### 🏠 Dashboard Repensé

Une page d'accueil intelligente qui s'adapte à votre activité.

- ✨ **UX adaptative** — Layouts différents pour boutiques nouvelles, en croissance et actives
- 📋 **Checklist flottante** — Progression de configuration toujours visible
- 📱 **QR code & partage** — Partagez votre vitrine en un clic
- 👋 **Salutations personnalisées** — Messages de bienvenue selon l'heure
- 🎨 **Gradient animé** — Touche visuelle subtile et moderne

### ✨ Autres améliorations

- 🎨 **Nouveau favicon** — Icône bleue rafraîchie pour les onglets
- 🔵 **Couleur de marque mise à jour** — Bleu primaire affiné (#2b62ef)
- 📊 **Analytics améliorés** — Meilleure intégration Umami & Gleap
- 💬 **Corrections SMS** — Accents et caractères spéciaux fonctionnels

---

## [1.3.0] - 17 janvier 2026

### 💳 Paiements en ligne

Acceptez les paiements directement sur votre vitrine avec **Stripe Connect**.

- 🔗 **Stripe Connect** — Intégration simple pour cloud et auto-hébergé
- 🔒 **Empreinte bancaire** — Autorisez sans débiter, libérez ou capturez ensuite
- 📊 **Suivi des paiements** — Statut en temps réel dans les réservations
- ✨ **Accès instantané** — Liens magiques pour suivre sa réservation

### 📱 Notifications SMS

Contactez vos clients directement sur leur téléphone.

- 📤 **SMS Partner** — Envoi de SMS (autres fournisseurs à venir)
- ⏰ **Rappels** — Notifications automatiques retrait & retour
- 🔗 **Liens d'accès** — Envoyez le lien de réservation par SMS
- 📈 **Limites par plan** — Quotas SMS selon l'abonnement

### 🛒 Accessoires & Ventes additionnelles

Augmentez votre panier moyen.

- 🔗 **Produits liés** — Associez des accessoires aux produits principaux
- 💡 **Suggestions intelligentes** — Affichage sur les pages produits
- ⚡ **Ajout rapide** — Un clic pour ajouter au panier

### 🧾 Gestion des taxes

Gérez la TVA selon vos besoins.

- 📊 **Taux personnalisés** — Définissez votre taux de TVA
- 🏷️ **Par produit** — Taux différent par article
- 👁️ **Mode d'affichage** — Prix TTC ou HT
- 📄 **Factures conformes** — Détail TVA sur les documents

### ✏️ Modification des réservations

Modifiez les réservations sans tout recommencer.

- 📅 **Changer les dates** — Ajustez la période de location
- ➕ **Ajouter des articles** — Produits ou services supplémentaires
- 💰 **Ajustements de prix** — Remises ou suppléments manuels
- ⚠️ **Alertes conflits** — Voyez les problèmes avant d'enregistrer

### 🏢 Clients professionnels

Meilleur support B2B.

- 🏛️ **Profils entreprise** — Raison sociale & numéro TVA
- 📍 **Adresse de facturation** — Distincte de l'adresse du magasin
- 👔 **Types de clients** — Particulier ou professionnel

### 📅 Export calendrier

Synchronisez avec votre agenda préféré.

- 📆 **Flux ICS** — Compatible Google, Apple, Outlook
- 🔄 **Sync automatique** — Mise à jour en temps réel
- 🔑 **Tokens sécurisés** — Régénérez à tout moment

### ✨ Autres améliorations

- 📊 **Analytics Umami** — Statistiques respectueuses de la vie privée
- 🐳 **Migrations auto** — Mises à jour BDD au démarrage Docker
- 💀 **Skeletons de chargement** — Affichage plus fluide
- 🎨 **UX repensée** — Détails réservation, meilleur contraste

---

## [1.2.0] - 15 janvier 2026

### 💼 Abonnements SaaS

Louez Cloud supporte maintenant les plans payants.

- 📊 **Limites par plan** — Produits, réservations, clients
- ⬆️ **Invitations upgrade** — Modales claires à l'approche des limites
- 💳 **Portail de facturation** — Gérez votre abonnement
- 🌍 **Multi-devises** — EUR, USD, GBP
- 🎉 **Early bird** — Réduction de lancement affichée

### 🛍️ Améliorations vitrine

- 👁️ **Aperçu produit** — Vue rapide sans quitter le catalogue
- 📅 **Sélecteur de dates** — Directement dans l'en-tête catalogue
- 🖼️ **Favicon personnalisé** — Votre logo dans l'onglet

### 👥 Gestion d'équipe

- 👤 **Limites collaborateurs** — Taille d'équipe selon le plan
- ⚙️ **Paramètres unifiés** — Tout au même endroit

### ✨ Qualité de vie

- 🖱️ **Glisser-déposer** — Upload d'images par glisser
- ⏰ **Horaires d'ouverture** — Activés par défaut
- 🖼️ **Meilleure gestion logos** — SVG vers PNG pour les PDFs

---

## [1.1.0] - 15 janvier 2026

### 🌍 6 nouvelles langues

Louez parle maintenant **8 langues** !

- 🇮🇹 Italien
- 🇳🇱 Néerlandais
- 🇵🇹 Portugais
- 🇩🇪 Allemand
- 🇪🇸 Espagnol
- 🇵🇱 Polonais

### 🚀 Installation simplifiée

- 🔧 **Config auto BDD** — Les nouvelles installations se configurent seules
- ✉️ **Emails modernes** — Design élégant et brandé
- 🔐 **OAuth amélioré** — Meilleurs messages d'erreur, liaison auto des comptes

### ✨ Qualité de vie

- ⏰ **Délai de préavis** — Les sélecteurs respectent vos paramètres
- 🖼️ **Miniatures produits** — Images dans les réservations manuelles
- 🌙 **Graphiques mode sombre** — Statistiques lisibles partout
- 💱 **Multi-devises** — Utilisez la devise de votre boutique

---

## [1.0.0] - 14 janvier 2026

### 🎉 Version initiale

Première version publique de Louez !

**Fonctionnalités principales**

- 🏢 **Multi-tenant** — Plusieurs boutiques, une installation
- 📦 **Produits** — Catalogue, catégories, tarifs dégressifs
- 📅 **Réservations** — Workflow complet
- 👥 **Clients** — Base de données avec historique
- ✉️ **Emails** — Notifications automatiques
- 📄 **Contrats PDF** — Documents professionnels
- 🎨 **Vitrines** — Sites de réservation personnalisés
- 👥 **Équipes** — Permissions par rôle
- 📊 **Statistiques** — Revenus & insights
- 🌍 **i18n** — Français & anglais

---

<div align="center">

_Pour les instructions de mise à jour, consultez la [documentation](https://louez.io/docs)._

</div>
