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

### 💰 Tax Management

**Status**: ✅ Available (January 16, 2026)

Handle taxes flexibly to match your local regulations.

| Feature | Description |
|---------|-------------|
| **Custom tax rates** | Define multiple tax rates (VAT, sales tax, etc.) |
| **Tax per product** | Assign different tax rates to different products |
| **Display mode** | Choose to show prices excluding tax (HT) or including tax (TTC) on storefront |
| **Invoice compliance** | Tax breakdown displayed on contracts and invoices |

> Useful for: Businesses operating in different tax jurisdictions, B2B vs B2C pricing display preferences.

---

### 🎯 Advanced Pricing Control

**Status**: ✅ Available (January 16, 2026)

Fine-tune rental prices for each reservation.

| Feature | Description |
|---------|-------------|
| **Price override** | Adjust the rental price up or down from the calculated amount |
| **Custom discounts** | Apply manual discounts for specific customers or situations |
| **Price justification** | Add notes explaining price adjustments |
| **Original vs final** | View both calculated and final prices in reservation details |

> Useful for: Negotiated rates, loyal customer discounts, special circumstances, promotional pricing.

---

### 🏢 Billing Address Options

**Status**: ✅ Available (January 16, 2026)

Separate your billing address from your store location.

| Feature | Description |
|---------|-------------|
| **Distinct billing address** | Set a different address for invoices and contracts |
| **Store location** | Keep your physical pickup location visible to customers |
| **Legal compliance** | Display registered business address on official documents |
| **Per-document control** | Choose which address appears on each document type |

> Useful for: Businesses with headquarters separate from rental locations, legal entity requirements.

---

### 💳 Online Payments

**Status**: ✅ Available (January 16, 2026)

Accept payments directly through your storefront.

| Feature | Description |
|---------|-------------|
| **Stripe Connect** | Seamless onboarding for cloud and self-hosted users |
| **Deposit holds** | Authorize deposits without charging, release or capture later |
| **Card on file** | Securely save customer payment methods |
| **Refunds** | Process full or partial refunds directly from dashboard |
| **Self-hosted support** | Connect your own Stripe account on self-hosted instances |

> Works on both Louez Cloud (managed onboarding) and self-hosted installations (bring your own Stripe account).
>
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

**Status**: ✅ Available (January 17, 2026)

Reach customers directly on their phones.

| Feature | Description |
|---------|-------------|
| **SMS Partner integration** | Send SMS via SMS Partner (more providers coming) |
| **Reservation reminders** | Automatic pickup/return reminders via SMS |
| **Instant access links** | Send reservation access links via SMS |
| **Plan-based limits** | SMS quotas based on your subscription plan |
| **Credit top-up** | Purchase additional SMS credits via Stripe (January 18, 2026) |

> Currently supports SMS Partner. Additional providers (Twilio, Vonage, etc.) planned for future releases.

---

### 📅 Calendar Export

**Status**: ✅ Available (January 16, 2026)

Share your reservations with external calendars.

| Feature | Description |
|---------|-------------|
| **ICS link** | Generate a shareable ICS link for your calendar |
| **Google Calendar** | Subscribe to reservations in Google Calendar |
| **Apple Calendar** | Add reservations to iCal/Apple Calendar |
| **Outlook sync** | Subscribe from Microsoft Outlook |
| **Secure token** | Regenerate link anytime to revoke access |

> Useful for: Viewing reservations alongside personal appointments, sharing availability with team members.

---

### 📅 Calendar Import (Blocked Slots)

**Status**: 📋 Planned

Import external calendars to automatically block availability.

| Feature | Description |
|---------|-------------|
| **ICS import** | Subscribe to external calendars (Google, Outlook, iCal) |
| **Auto-block slots** | Automatically block rental availability during external events |
| **Vacation sync** | Block dates from your personal calendar |
| **Multiple sources** | Connect several external calendars |

> Useful for: Blocking vacation days automatically, syncing with other booking platforms, preventing double-bookings.

---

### ⭐ Review Booster

**Status**: ✅ Available (January 18, 2026)

Grow your online reputation automatically.

| Feature | Description |
|---------|-------------|
| **Automated requests** | Send review requests via email or SMS after completed rentals |
| **Google Reviews link** | Direct customers to leave a Google review |
| **Timing control** | Configure when to send (e.g., 24h after return) |
| **Multi-language support** | Send review requests in the customer's preferred language |

---

### 🌟 Google Reviews Display

**Status**: ✅ Available (January 18, 2026)

Showcase your reputation on your storefront.

| Feature | Description |
|---------|-------------|
| **Auto-sync** | Automatically fetch and display your Google reviews |
| **Review widget** | Beautiful widget showing rating and recent reviews |
| **Responsive design** | Adapts to any screen size |
| **Localized display** | Reviews displayed in the appropriate language context |

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

### 🔗 Related Products & Accessories

**Status**: ✅ Available (January 17, 2026)

Suggest complementary items to increase average order value.

| Feature | Description |
|---------|-------------|
| **Product linking** | Associate related products (e.g., helmet with bike) |
| **Storefront suggestions** | Display related items on product pages |
| **Quick add to cart** | Customers can add accessories with one click |
| **Automatic pricing** | Accessories use their own pricing tiers |

> Useful for: Upselling accessories, safety equipment bundles, complete rental packages.

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

**Last updated**: January 18, 2026

📋 **See what's already shipped in our [Changelog](CHANGELOG.md)**

</div>
