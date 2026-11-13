---
type: fixed
---

## Online payments work with the bundled Compose stack

On a self-hosted install started with the bundled `docker-compose.yml`, online payments stayed off even with Stripe configured: the Stripe Connect webhook secret set in `.env` never reached the app. The Compose file now passes `STRIPE_CONNECT_WEBHOOK_SECRET` through, so setting it with `STRIPE_SECRET_KEY` turns payments on after `docker compose up -d`.
