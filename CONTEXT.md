# Louez

Louez is a rental management platform where each store manages its own reservations, customers, payments, and accounting-facing exports. This context records domain language that must stay clear in product, support, and implementation discussions.

## Language

**Store**:
A rental business using Louez to manage its catalog, reservations, and payments.
_Avoid_: account, tenant

**Customer**:
A person or organization renting equipment from a Store.
_Avoid_: client, buyer

**Reservation payment**:
A payment made by a Customer for a Store reservation.
_Avoid_: Louez sale, platform payment

**Stripe fee**:
A fee charged by Stripe on a Reservation payment.
_Avoid_: Louez commission, platform commission

**Louez commission**:
A fee charged by Louez on a Reservation payment; Louez currently does not charge this.
_Avoid_: Stripe commission

**Accounting export**:
A file exported from Louez that summarizes operational or payment data for a Store.
_Avoid_: invoice, bill

## Relationships

- A **Store** receives **Reservation payments** from **Customers**.
- A **Reservation payment** can produce **Stripe fees**.
- A **Stripe fee** is charged by Stripe, not by Louez.
- A **Louez commission** is distinct from a **Stripe fee** and is currently not charged on Reservation payments.
- An **Accounting export** can help reconcile payments, but it is not an invoice from Stripe or Louez.

## Example dialogue

> **Dev:** "Should we generate a Louez commission invoice for this Store?"
> **Domain expert:** "No. Louez does not charge commissions on reservations; the Store needs help finding Stripe fee documents or reports."

## Flagged ambiguities

- "Factures Stripe des commissions" was used to describe fees paid on online payments. Resolved: these are **Stripe fees**, not **Louez commissions**.
