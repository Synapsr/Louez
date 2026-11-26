---
type: fixed
---

## Customers can pay the balance left after a deposit

When a store takes only part of the rental online, the customer's account now shows the reservation as confirmed with the balance still due, and its amount. A "Pay the balance" button opens a payment of exactly what remains, until nothing is left; the reservation then reads "All set". The balance is shown in the reservation's own currency, and a rental that has ended can still pay what it owes.

A customer who comes back to an interrupted checkout after their booking was confirmed now sees what remains to pay, with a link to their booking, instead of being told that no further payment is needed.

No charge is rounded above what is owed. In currencies without decimals, such as the yen, every rental charge, the balance the customer sees and the remaining amount on the reservation round down to the currency's smallest unit: ¥100.60 owed is charged ¥100, and a leftover below one yen counts as paid.

When what a customer owes goes down, the payment pages they have open close, so they cannot pay the old amount: after you record a payment by hand, lower the total, cancel or reject the reservation, or delete a refund you recorded, and when a refund fails at Stripe. A payment the customer completed in that same moment is kept: it shows on the reservation as paid above its total, and you refund the difference.

For integrators: each reservation in the API's reservation list now includes its `currency`.
