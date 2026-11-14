---
type: improved
---

## You approve the payments, overbookings and team removals your assistant asks for

When a connected assistant or an API key asks to record a payment or a deposit return, delete a payment, remove a member, cancel an invitation, or confirm a reservation over your stock or past your turnover buffer, nothing happens until you approve it. The assistant gives you a link: you open it signed in to Louez, read Louez's own summary of the action, and approve or refuse. This holds even on a connection whose confirmations are turned off. You have nothing to set up; actions you take yourself in the dashboard, or ask the in-app assistant for, run as before.

For an integration, the first call of these actions now answers `APPROVAL_REQUIRED` (HTTP 412) instead of `CONFIRMATION_REQUIRED`, with a link for the key's owner in `data.details.approval.url`. Read `GET /handoffs/{id}` (MCP: `handoffs_get`) with the approval's id until it is `approved`, then send the same request again with that id in `Louez-Confirmation` (MCP: `confirmationToken`). An integration that sends the confirmation token back, as before, gets `APPROVAL_REQUIRED` again and changes nothing, so it cannot carry these actions out without a person. A token issued for them before this release no longer works. Every other confirmation is unchanged. The API reference's "Approvals" section lists every answer.

Before, the first call answered:

```json
{
  "status": 412,
  "data": {
    "code": "CONFIRMATION_REQUIRED",
    "details": { "preview": { "summary": "…" }, "confirmationToken": "…", "expiresAt": "…" }
  }
}
```

Now it answers:

```json
{
  "status": 412,
  "data": {
    "code": "APPROVAL_REQUIRED",
    "details": {
      "preview": { "summary": "…" },
      "approval": {
        "id": "…",
        "url": "https://…/handoffs/…",
        "status": "pending",
        "expiresAt": "…",
        "pollAfterSeconds": 30,
        "decision": null
      },
      "confirmationToken": "…"
    }
  }
}
```
