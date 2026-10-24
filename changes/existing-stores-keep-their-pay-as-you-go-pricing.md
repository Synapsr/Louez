---
type: changed
---

## Existing stores keep their pay-as-you-go pricing when the offer for new stores changes

Until now, a store with no pricing stored on its subscription paid whatever `PAYG_DEFAULT_PRICING` said at the time, and a store with no subscription row also got the current `PAYG_FREE_RESERVATIONS`. Changing either variable repriced those stores without notice. Every store now pays the pricing written on its own subscription row, and the two variables only apply to stores created afterwards. Switching between a plan and pay-as-you-go, a subscription that ends, a referral reward and an admin save no longer change what a store pays.

Self-hosting: billing is off unless `LOUEZ_BILLING=cloud`. Nothing is written for self-hosted stores, single-store or multi-store: no new subscription or fee rows, no month-end invoices, no referral rewards, and no Stripe Connect fee on reservation payments, so customers' payments reach the store in full. Louez sets no SMS or AI-credit quota, since you pay your own providers, and refuses platform charges (plan checkout, SMS and AI top-ups). Rows an earlier version wrote are kept but no longer used: fees recorded before the upgrade are never invoiced, and a plan subscription already running on your Stripe account keeps renewing until it is cancelled. Migration `0081_pricing_version` adds `subscriptions.pricing_version` and tags the rows that already hold pricing; it reads no variable and changes no price.

Louez Cloud: set `LOUEZ_BILLING=cloud` in the environment before deploying. Migration `0081_pricing_version` then tags every subscription row. Confirm with the read-only audit (`pnpm payg:audit-pricing`) that no row has an empty config and no store lacks a row. At start-up, the app logs an error when `LOUEZ_BILLING` holds a value other than `off` or `cloud`, or when `LOUEZ_MODE=platform` and `STRIPE_PRICE_PRO_MONTHLY` are set but `LOUEZ_BILLING` is not.
