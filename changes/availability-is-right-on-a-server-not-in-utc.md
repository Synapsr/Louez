---
type: fixed
---

## Availability is right on a server that is not in UTC

On a self-hosted instance whose server ran in another time zone than UTC, the stock check compared a booking's end with the wrong hour: a booking that ended an hour or two into a new one could go unseen, or one that was over could still block. Louez now sends every date to the database in UTC, whatever the server's time zone. A server in UTC, the default of the Docker image, was not affected.
