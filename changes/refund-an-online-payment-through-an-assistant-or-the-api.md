---
type: new
---

## Refund an online payment through an assistant or the API

Your assistant (with `refund_payment`) and your scripts (with `POST /payments/{paymentId}/refunds`) can now refund all or part of a payment your customer made online, back to the card that paid it, through Stripe. Each refund waits for your approval on a Louez page, which shows the amount, the card it goes back to, the payment, what was already refunded and what stays refundable, in the payment's own currency. The money leaves your Stripe balance; the platform fee on that part is returned. No message is sent to your customer.

One approval gives one refund, never two, even if the request is sent again or Stripe is slow to answer. If Stripe has not answered yet, the refund shows as pending, and `get_refund` (or `GET /payments/{paymentId}/refunds/{refundId}`) tells how it ended. Stripe can still refuse a refund after your approval, for example if a dispute was opened meanwhile: the refund then shows as failed with the reason, and nothing else changes. Partial refunds can follow one another; a refund made in between ends an approval given before it. The dashboard has no button for this yet.
