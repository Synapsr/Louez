---
type: fixed
---

## A write that may have gone through is never run twice

A retry with the same idempotency key no longer runs a write again after an unexpected failure. Before, a write that answered `500` was run again by its retry, even when the first call had already saved it, so a payment could be recorded twice. Now a call Louez refused, with an error that has a `data.code` such as `CONFIRMATION_REQUIRED` or `RESERVATION_BUSY`, still runs again with the same key. A call that ended on an unexpected failure answers `OPERATION_OUTCOME_UNKNOWN` with `details.operationId` to every retry with its key: check the current state, then use a new key if the write is still needed.
