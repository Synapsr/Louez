---
type: fixed
---

## A write that may have gone through is never run twice

A retry with the same idempotency key no longer runs a write again when Louez does not know how the first call ended. Before, a write that answered `500` was run again by its retry, even when the first call had already saved it, so a payment could be recorded twice. Now a retry with the same key answers by how the first call ended: a call that succeeded returns its stored result; a call Louez refused before doing it (such as `CONFIRMATION_REQUIRED`, `PERMISSION_DENIED` or `RESERVATION_BUSY`) runs again; a call whose outcome Louez does not know (it ended on an error Louez did not expect, or its outcome was not recorded) answers `OPERATION_OUTCOME_UNKNOWN` with `details.operationId` and never runs again. Then check the current state, and use a new key if the write is still needed; a write that asks for a confirmation needs a new preview, as the old token is spent if the write went through. If you do not know how a call ended, retry it with the same key: the answer says which it was.
