# Changelog

> 🇬🇧 **English** | [🇫🇷 Français](#changelog-fr)

All notable changes to Louez are documented here.

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

*For upgrade instructions, see the [documentation](https://louez.io/docs).*

</div>

---
---

<a id="changelog-fr"></a>

# Changelog (Français)

> [🇬🇧 English](#changelog) | 🇫🇷 **Français**

Toutes les évolutions notables de Louez sont documentées ici.

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

*Pour les instructions de mise à jour, consultez la [documentation](https://louez.io/docs).*

</div>
