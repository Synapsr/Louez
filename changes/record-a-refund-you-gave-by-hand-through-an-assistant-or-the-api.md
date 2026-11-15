---
type: new
---

## Record a refund you gave by hand through an assistant or the API

Your assistant (with `record_refund`) and your scripts (with `POST /payments/{paymentId}/refunds`) can now record a refund you already gave outside Louez, in cash, on your card terminal, by bank transfer, by cheque or otherwise, against one payment you took by hand. Each one waits for your approval on a Louez page, which shows the refund, the payment it gives back, what was already refunded and what stays refundable, in the payment's own currency. Louez only records it: no money moves. The credit note follows when you issue invoices.

Partial refunds can follow one another up to the payment's amount. Two refunds sent at the same moment can never give back more than the payment between them, and a refund recorded after your approval was given ends that approval. The dashboard's refund dialog records through the same rules, and now also refuses a payment taken online through Stripe. Refunds of online payments are not available through this action yet.
