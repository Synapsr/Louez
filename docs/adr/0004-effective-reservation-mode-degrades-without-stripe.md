# Reservation Mode Is Intent; the Storefront Runs on an Effective Mode That Degrades Without Stripe

A Store's **Reservation Mode** records intent (Request or Payment), and **Payment Mode is the default offered at onboarding**. Onboarding does **not** perform Stripe KYC. To avoid a broken storefront in the gap between "Store wants Payment Mode" and "Stripe is chargeable", the storefront runs on a derived **Effective Reservation Mode**: a Store in Payment Mode whose Stripe is not `chargesEnabled` behaves exactly as Request Mode (reservation request, manual approval, off-line payment) and upgrades to online checkout **automatically** once `chargesEnabled` becomes true. No manual switch, no customer-facing dead end.

## Considered Options

- **Keep the current behavior** — in Payment Mode without Stripe, create the reservation with `paymentUrl = null`. Rejected: the Customer is "confirmed" but cannot pay and sees a missing-payment dead end; it reads as broken.
- **Block the storefront** until Stripe is set up. Rejected: it kills customer acquisition from day one, the opposite of making Payment Mode the default.
- **Force Stripe KYC inside onboarding** so Payment Mode is always backed by a chargeable account. Rejected: KYC is long and external (redirect to Stripe), it inflates onboarding drop-off, and it blocks stores that just want to take requests first.
- **Derive an Effective Reservation Mode** from intent + Stripe readiness, degrading Payment → Request and auto-upgrading on `chargesEnabled`. Chosen.

## Consequences

- The storefront and checkout must compute behavior from the **Effective Reservation Mode**, never from `settings.reservationMode` alone. The chargeable check is `stripeAccountId && stripeChargesEnabled`.
- The auto-upgrade is driven by the existing Stripe `account.updated` webhook flipping `stripeChargesEnabled`; no store action and no re-onboarding is required when Stripe becomes ready.
- Setting Payment Mode as the onboarding default is **safe** precisely because of this degradation — it can never produce an unusable storefront.
- The dashboard must surface that a Store in Payment Mode is currently operating in Request Mode (Stripe not finished) as a setup task / alert, so the degradation is visible to the owner and not silent.
- "Degraded" / "fallback" stays internal language; Customer- and owner-facing copy describes the concrete behavior (e.g. "réservation sur demande, paiement sur place") rather than an error state.
