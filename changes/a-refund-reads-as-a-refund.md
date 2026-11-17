---
type: fixed
---

## A refund reads as a refund, and the edit only promises one that is due

On a reservation's page, a refund of an online payment no longer shows as money received. The online payment tile in the Payments card now tells the latest of the rental's online money: the payment received, or a refund of it, with a minus sign, as the payment history shows a refund recorded by hand. A refund the bank is still processing reads "Refund in progress" until Stripe confirms it, and one Stripe failed reads failed and struck out, never as money given back.

The reservation's history no longer calls such a refund "Payment updated" with a plus sign. It says "Refund made", "Refund in progress" or "Refund failed", with the amount given back and, for a refund your assistant asked for, the person who approved it. The line Stripe adds for the payment states the total refunded online. Older lines read the same way: nothing in them is rewritten.

Your customer's account page shows a refund still being processed as pending, and a refund made as refunded, instead of paid.

When you edit a reservation's total, the hint under the difference now reads what the customer actually paid. If they paid more than the new total, it gives the amount to refund; if they still owe money, it says what is left to pay, and promises no refund. For example, a 72.00 reservation with 42.00 paid, lowered to 56.00, now reads "Remaining: 14.00" instead of offering a 16.00 refund.

For an integration, `GET /reservations/{id}` (MCP: `reservations_get`) now lists `refunds`: each refund asked with `refund_payment`, its status as `get_refund` gives it, its payment row once Stripe made it, and who approved it.
