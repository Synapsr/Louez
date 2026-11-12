---
type: fixed
---

## A deposit hold is placed once on the customer's card

Asking for a deposit hold twice at the same moment, with a second click, from two tabs or through an assistant, now places a single hold on the customer's card. When Stripe is slow to answer or fails, Louez asks about the same hold instead of placing another: until Stripe confirms or refuses it, no second hold is placed. Releasing or capturing a hold only ever touches that hold: one your customer authorized in the meantime stays on their card and on the reservation. A second authorization of a deposit already held is released, and Louez keeps asking Stripe until it is. The expiry date shown for a hold is the date the bank gives it up, and a hold placed before you changed Stripe account can still be captured or released.
