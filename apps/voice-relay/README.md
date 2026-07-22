# @louez/voice-relay

A thin, standalone Node WebSocket worker that bridges **Twilio ConversationRelay**
and the app's **Server-Sent-Events turn endpoint**.

Twilio ConversationRelay owns the call media — Deepgram speech-to-text,
ElevenLabs text-to-speech, endpointing and barge-in — and opens a single
WebSocket to this worker for each call, exchanging JSON text messages. For every
finished caller utterance the worker POSTs the text to the app's
`/api/voice/turn` endpoint (an SSE stream) and relays the assistant's tokens
back to Twilio as they arrive, so Twilio can synthesize speech token-by-token.
On barge-in it aborts the in-flight turn.

The worker holds **zero business logic and zero database access**. It is fully
standalone: it does not import anything from the rest of the monorepo, and its
only runtime dependency is [`ws`](https://github.com/websockets/ws) (everything
else uses the Node standard library — global `fetch`, `node:crypto`,
`node:http`).

## How it fits together

```
Caller ── phone ──▶ Twilio ConversationRelay ── WebSocket ──▶ voice-relay
                                                                   │
                                                    POST /api/voice/turn (SSE)
                                                                   ▼
                                                              the app
```

1. The app renders TwiML that connects the call to this worker's `wss` URL,
   already signed for the call: `wss://<host>/relay?c=<conversationId>&t=<token>`
   where `t = base64url(HMAC-SHA256(VOICE_RELAY_SIGNING_SECRET, conversationId))`.
2. The worker validates the token (constant-time) before accepting the socket.
3. For each final `prompt`, the worker POSTs
   `{ conversationId, callSid, text }` to `TURN_ENDPOINT_URL`, signing the raw
   body with `x-relay-signature: base64url(HMAC-SHA256(secret, body))`.
4. It streams the SSE `token` events back to Twilio, then closes the turn and
   acts on the `end` control (`continue` / `end` / `transfer`).

## Environment variables

| Variable                     | Required | Default | Description                                                        |
| ---------------------------- | -------- | ------- | ------------------------------------------------------------------ |
| `PORT`                       | no       | `8080`  | Port for the HTTP health check and WebSocket upgrades.             |
| `TURN_ENDPOINT_URL`          | yes      | —       | Absolute https URL of the app's SSE turn endpoint.                 |
| `VOICE_RELAY_SIGNING_SECRET` | yes      | —       | HMAC secret shared with the app (handshake + turn signing).        |

The worker **fails fast at startup** if `TURN_ENDPOINT_URL` or
`VOICE_RELAY_SIGNING_SECRET` is missing. See [`.env.example`](./.env.example).

## Endpoints

- `GET /health` → `200 ok`
- WebSocket upgrade on paths starting with `/relay` (all others are rejected).

## Develop

```sh
# from the monorepo root
pnpm --filter @louez/voice-relay build       # compile to dist/
pnpm --filter @louez/voice-relay type-check   # tsc --noEmit
pnpm --filter @louez/voice-relay dev          # watch mode (requires Node >= 22)
pnpm --filter @louez/voice-relay start        # run dist/index.js
```

`dev` uses Node's native TypeScript stripping (`--experimental-strip-types`),
which requires Node 22+. `build` / `start` work on Node 20+.

## Deploy (Fly.io)

The service is stateful (persistent WebSockets), so it always keeps at least one
machine running and never auto-stops. See [`fly.toml`](./fly.toml).

```sh
# One-time
fly launch --no-deploy --copy-config --name louez-voice-relay

# Set the primary_region in fly.toml to match the app's region (see below),
# then provide the secrets:
fly secrets set TURN_ENDPOINT_URL="https://app.example.com/api/voice/turn"
fly secrets set VOICE_RELAY_SIGNING_SECRET="<the same secret the app uses>"

# Deploy
fly deploy
```

> **Region colocation:** deploy this worker in the **same Fly region as the app**
> that serves `TURN_ENDPOINT_URL`. Each spoken token makes a round trip to the
> app, so cross-region latency is heard directly by the caller.

## App-side wiring

For the app to route calls here it must set (in the app's own environment):

- `VOICE_RELAY_WS_URL` — this service's public `wss://` base URL.
- `VOICE_RELAY_SIGNING_SECRET` — **identical** to the value configured here.

The app appends `?c=<conversationId>&t=<token>` to `VOICE_RELAY_WS_URL` when it
renders the ConversationRelay TwiML.
