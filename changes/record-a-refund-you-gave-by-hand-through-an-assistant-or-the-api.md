---
type: new
---

## Record a refund you gave by hand through an assistant or the API

Your assistant (with `record_refund`) and your scripts (with `POST /payments/{paymentId}/refund-records`) can now record a refund you already gave outside Louez, in cash, on your card terminal, by bank transfer, by cheque or otherwise, against one payment you took by hand. Each one waits for your approval on a Louez page, which shows the refund, the payment it gives back, what was already refunded and what stays refundable, in the payment's own currency. Louez only records it: no money moves. When you issue invoices, its credit note is issued once, even if invoicing fails for a moment: Louez tries again on its own.

Partial refunds can follow one another up to the payment's amount, in the payment's own currency and to its own precision: no decimals in yen. Two refunds sent at the same moment can never give back more than the payment between them, and a refund recorded after your approval was given ends that approval. The dashboard's refund dialog records through the same rules, and now also refuses a payment taken online through Stripe. A payment taken online is refunded through Stripe instead, with `refund_payment`.
