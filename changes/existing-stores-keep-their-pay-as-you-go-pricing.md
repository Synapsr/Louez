---
type: changed
---

## Existing stores keep their pay-as-you-go pricing when the offer for new stores changes

Until now, a store with no pricing stored on its subscription paid whatever `PAYG_DEFAULT_PRICING` said at the time, and a store with no subscription row also got the current `PAYG_FREE_RESERVATIONS`. Changing either variable repriced those stores without notice. Every store now pays the pricing written on its own subscription row, and the two variables only apply to stores created afterwards. Switching between a plan and pay-as-you-go, a subscription that ends, a referral reward and an admin save no longer change what a store pays.

Self-hosting: migration `0081_pricing_version` adds `subscriptions.pricing_version`. On the first start of this version, the app writes the current values of `PAYG_DEFAULT_PRICING` and `PAYG_FREE_RESERVATIONS` onto the stores that followed them live, and creates a subscription row for each store that had none. It logs what it wrote, and stops if that step fails, like a failed migration. Upgrade first and change the variables afterwards: values changed in the same deploy would be written onto your existing stores. A database dump taken before the upgrade gets the values in force when it is first started on this version. Stores that had no subscription row are now part of the month-end pay-as-you-go run; without usage they are not charged.
