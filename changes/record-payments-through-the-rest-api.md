---
type: new
---

## Record payments and deposit returns through the REST API

Your scripts and integrations can now record a payment on a reservation, record a deposit you gave back, and delete a payment through the REST API, with an API key that may change payments. Each one first answers with a preview of what it will do, and runs once you send it again with the confirmation it gave, whatever the key's confirmation setting. The MCP tools `record_payment`, `record_deposit_return` and `delete_payment` work the same way and now answer with the payment's details and a receipt. Sent again with the same idempotency key after it was recorded, a payment is not recorded twice: you get the first answer back.

Two deposit returns recorded at the same moment through the deposit-return operation (`record_deposit_return`, or `POST /reservations/{reservationId}/deposit-returns`) can no longer give back more than the deposit you collected: the second one sees the first and is refused. The dashboard assistant now refuses a negative amount on anything but an adjustment, as the MCP tools already did.
