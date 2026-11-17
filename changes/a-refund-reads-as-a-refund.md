---
type: fixed
---

## A refund reads as a refund, said made only once Stripe confirms it

On a reservation's page, a refund of an online payment no longer shows as money received. The online payment tile in the Payments card now tells the latest of the rental's online money: the payment received, or a refund of it, with a minus sign, as the payment history shows a refund recorded by hand. Louez counts a refund as soon as Stripe makes it, but only says it was made once it knows Stripe settled it:

- A refund your assistant asked for reads "Refund in progress" until Stripe confirms it, then "Refund made".
- A refund made in Stripe's own dashboard, or by Louez before refunds were tracked to the end, reads "Refund issued at Stripe": Stripe made it, and Louez has no word on whether it settled.
- A refund Stripe failed reads failed and struck out, never as money given back.
- A payment refunded in full is labelled refunded only once each of its refunds is known made.

The reservation's history no longer calls a refund "Payment updated" with a plus sign. It names the refund and its state as above, with the amount given back and, for a refund your assistant asked for, the person who approved it. This also applies to the lines written earlier by the dashboard's online refunds and by refunds recorded by hand. Nothing in them is rewritten. The line Stripe adds when a payment is refunded now says what Stripe counted on the payment at that moment, for example "Stripe counts €30.00 of refunds on this payment", as information: that count includes refunds still in progress.

On your customer's account page, each refund reads refunded, issued or in progress, never "paid", and a refund that failed is not listed. The page's history no longer shows Stripe's count of refunds as a refund made.

When you edit a reservation's total, the hint under the difference now reads what the customer actually paid. If they paid more than the new total, it gives the amount to refund. If they still owe money, it says what is left to pay, and promises no refund. For example, a 100.00 reservation with 60.00 paid, lowered to 80.00, now reads "Remaining: 20.00" instead of offering a 20.00 refund.

For an integration, `GET /reservations/{id}` (MCP: `reservations_get`) now lists `refunds`: each refund asked with `refund_payment`, its status as `get_refund` gives it, its payment row once Stripe made it, and who approved it.
