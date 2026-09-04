Accessories already existed, but every one of them was optional: a suggestion to the customer, theirs to take or leave. Some should not be optional. A helmet with a bike, a harness with a rope, a refill with a stove.

## Required, and in what quantity

In the **Accessories** card, each attached accessory now carries a **Required** switch. Turn it on and a quantity field appears: how many units of this accessory per unit of the parent product. One helmet per bike, two gloves per pair of skis.

Left off, the accessory behaves as before: "Only suggested to the customer."

## What it changes in the cart

When the customer adds the parent product, the required accessory places itself underneath, labelled **Required with …**. That line has no Remove button, and its quantity cannot go below the minimum.

It follows the parent: three bikes instead of one, and the line goes from one helmet to three. The customer can add more if they want more, up to the stock. Remove the bike and the helmets go with it.

Charged at zero, the accessory reads **Included** instead of a price.

## The rule holds on the server too

This is not just interface politeness. When the order is submitted, the server recomputes what the cart should have contained and rejects one that is missing a required accessory, or that has the wrong quantity of it. A cart assembled from the outside does not get through.

A required accessory that has run out also blocks the parent product from being booked, with the reason shown on the listing, rather than failing at payment time.

## The accessory picker was rebuilt along the way

Dense rows with the price inline, search at the top of the dialog, and above all a selection that works as a toggle: a picked product stays where it is, checked, instead of vanishing from the list under your cursor. The footer counts what is selected.

Products are now listed in your catalogue's own order, the same one the Products page and your shop use.

---

A required accessory is often a consumable — the pair of gloves that goes out with the skis. See [The things that leave with your customer](/dashboard/whats-new/consumable-stock).
