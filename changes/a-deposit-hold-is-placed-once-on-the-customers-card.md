---
type: fixed
---

## A deposit hold is placed once on the customer's card

Asking for a deposit hold twice at the same moment, with a second click, from two tabs or through an assistant, now places a single hold on the customer's card. When Stripe is slow to answer or fails, Louez asks about the same hold instead of placing another: until Stripe confirms or refuses it, the reservation says the hold is not confirmed, your inbox shows it, and no second hold is placed. Releasing or capturing a hold only ever touches that hold: one your customer authorized in the meantime stays on their card and on the reservation. A second authorization of a deposit already held is released, and Louez keeps asking Stripe until it is; the payment history shows it as being released, never as a hold, and your inbox tells you when Stripe has not confirmed the release after half an hour. When Stripe never confirms a hold you asked for, the reservation's deposit section lets you settle it: tell Louez you found nothing in your Stripe dashboard and ask for a new hold, or paste the payment ID Stripe shows and Louez records it once it matches. Should Stripe make that hold after all, Louez records it and releases it. A failed attempt no longer warns you once another hold succeeded, and the payment history keeps only the latest failed attempt.

What is not covered yet: a hold your customer gives on their own page while one you asked for is still unconfirmed can place two holds; the second is released. The expiry date shown for a hold is the date the bank gives it up, and a hold placed before you changed Stripe account can still be captured or released.
