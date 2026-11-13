---
type: improved
---

## A step your assistant hands you keeps one link

When your AI assistant hands you a step only you can take in Louez, such as connecting Stripe, adding the billing card or approving a team invitation, its link now stays the same for the whole step. If the assistant asks again, you get the same link with more time to use it, and an earlier tab still works. `handoffs_get` (`GET /handoffs/{id}`) now returns the link as `url`, so the assistant can give it to you again, and the inbox's waiting step opens that page directly. If the assistant asked again while the page was open, nothing is done when you click: the page shows the request as it is now and asks you again, so you only ever approve what you read.
