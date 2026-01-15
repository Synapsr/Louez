# Roadmap

> 🎯 **Our Philosophy**: Louez aims to be a modern, simple tool that covers **80% of rental business needs**. We deliberately avoid over-specialization and feature bloat. For highly specific requirements, specialized software exists — but for most rental businesses, Louez is all you need.

## Current Status

Louez is production-ready with core rental management features:

- ✅ Multi-tenant architecture
- ✅ Product & inventory management
- ✅ Reservation system with status workflow
- ✅ Customer database
- ✅ Automated email notifications
- ✅ PDF contract generation
- ✅ Customizable storefronts
- ✅ Team management with roles
- ✅ Statistics & reporting
- ✅ i18n (French, English, Italian, Dutch, Portuguese, German, Spanish, Polish)

---

## Planned Features

### 🌍 Languages

**Status**: ✅ Available

Louez supports multiple languages out of the box.

| Language | Status |
|----------|--------|
| 🇫🇷 French | ✅ Available |
| 🇬🇧 English | ✅ Available |
| 🇮🇹 Italian | ✅ Available |
| 🇳🇱 Dutch | ✅ Available |
| 🇵🇹 Portuguese | ✅ Available |
| 🇩🇪 German | ✅ Available |
| 🇪🇸 Spanish | ✅ Available |
| 🇵🇱 Polish | ✅ Available |

> **Want to contribute a translation?** We welcome community translations! Check our [contributing guide](README.md#-contributing) to help translate Louez into your language.
>
> **Need another language?** Feel free to [open a discussion](https://github.com/synapsr/louez/discussions) or send us a message — we're happy to add more languages based on community interest!

---

### 💳 Online Payments

**Status**: 🔜 Coming Soon

Accept payments directly through your storefront.

| Feature | Description |
|---------|-------------|
| **Stripe Connect** | First payment provider, with platform fees support |
| **Payment links** | Send payment requests via email |
| **Deposits & balances** | Collect deposits, manage remaining payments |
| **Refunds** | Process refunds directly from dashboard |

> *Future*: Additional payment providers (PayPal, Mollie, etc.) via a connector system.

---

### 🔔 Notifications

**Status**: 📋 Planned

Keep your team informed in real-time.

| Integration | Use Case |
|-------------|----------|
| **Discord** | Get notified in your Discord server when new reservations arrive |
| **Slack** | Receive alerts in Slack channels for your team |
| **Webhooks** | Connect to any service via custom webhooks |

---

### 📱 SMS Notifications

**Status**: 📋 Planned

Reach customers directly on their phones.

| Feature | Description |
|---------|-------------|
| **Provider agnostic** | Connect any SMS provider (Twilio, OVH, Vonage, etc.) |
| **Reservation reminders** | Automatic pickup/return reminders via SMS |
| **Custom messages** | Send manual SMS from the dashboard |
| **Templates** | Configurable SMS templates per event type |

---

### 📅 Calendar Sync

**Status**: 📋 Planned

Sync reservations with external calendars.

| Feature | Description |
|---------|-------------|
| **Google Calendar** | Two-way sync with Google Calendar |
| **iCal export** | Export reservations to any calendar app |
| **Block time slots** | Block availability from external calendar events |
| **Outlook sync** | Microsoft 365 calendar integration |

> Useful for: Viewing reservations alongside personal appointments, blocking vacation days automatically.

---

### ⭐ Review Booster

**Status**: 📋 Planned

Grow your online reputation automatically.

| Feature | Description |
|---------|-------------|
| **Automated requests** | Send review requests via email or SMS after completed rentals |
| **Google Reviews link** | Direct customers to leave a Google review |
| **Timing control** | Configure when to send (e.g., 2 days after return) |
| **Smart filtering** | Only request reviews from satisfied customers |

---

### 🌟 Google Reviews Display

**Status**: 📋 Planned

Showcase your reputation on your storefront.

| Feature | Description |
|---------|-------------|
| **Auto-sync** | Automatically fetch and display your Google reviews |
| **Review widget** | Beautiful widget showing rating and recent reviews |
| **Moderation** | Choose which reviews to display |
| **Rich snippets** | SEO-optimized review data for search engines |

---

### 📸 Condition Reports

**Status**: 📋 Planned

Document equipment condition before and after rentals.

| Feature | Description |
|---------|-------------|
| **Photo capture** | Take photos at pickup and return |
| **Before/after comparison** | Side-by-side view of equipment condition |
| **Damage notes** | Add comments and annotations |
| **Attach to contract** | Include photos in rental agreements |
| **Mobile-friendly** | Easy capture from phone or tablet |

---

## Design Principles

As we build new features, we follow these principles:

### ✅ What we DO

- **Keep it simple** — Features should be intuitive without documentation
- **Cover common needs** — Focus on what 80% of rental businesses need
- **Stay flexible** — Work for cameras, tools, vehicles, party equipment, and more
- **Integrate openly** — Provide webhooks and APIs for custom integrations
- **Respect privacy** — Self-hosted first, your data stays yours

### ❌ What we DON'T

- **Over-specialize** — We won't add niche features for specific industries
- **Feature bloat** — Every feature must earn its place
- **Lock-in** — No proprietary formats, easy data export
- **Complexity creep** — If it needs a manual, it's too complex

---

## Contributing

Want to help build these features? We welcome contributions!

- 💬 **Discuss** — Share ideas in [GitHub Discussions](https://github.com/synapsr/louez/discussions)
- 🐛 **Report** — Found a bug? Open an [issue](https://github.com/synapsr/louez/issues)
- 🔧 **Build** — Submit a PR for any planned feature

---

## Request a Feature

Have an idea that's not on this list?

1. Check if it fits our [design principles](#design-principles)
2. Open a [discussion](https://github.com/synapsr/louez/discussions) to gather feedback
3. If there's interest, we'll add it to the roadmap

---

<div align="center">

*This roadmap is a living document. Priorities may shift based on community feedback.*

**Last updated**: January 2025

</div>
