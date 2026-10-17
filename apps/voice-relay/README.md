# GPT-Live voice relay

Twilio Media Streams ↔ OpenAI GPT-Live, with application-owned rental tools.
The Docker image runs a single bundle built from the frozen workspace lockfile.
It performs no dependency resolution at deployment time.
The worker has no database credentials and contains no pricing, availability or
reservation logic. Shared protocol schemas and voice presets live in
`packages/voice`; the Next.js app owns store authorization and durable state.

## Runtime

Node 22+, pnpm 10.27.0. Build from the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @louez/voice build
pnpm --filter @louez/voice-relay build
# Export the variables documented in .env.example, then:
pnpm --filter @louez/voice-relay start
```

| Variable                                   | Required | Purpose                                                                                |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `APP_URL`                                  | Yes      | HTTPS origin of the web app. Requests go to `/api/voice/live`.                         |
| `VOICE_RELAY_WS_URL`                       | Yes      | Public WSS origin of this worker, without a path. Used to validate Twilio signatures.  |
| `VOICE_RELAY_SIGNING_SECRET`               | Yes      | At least 32 random characters; identical on the web app.                               |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Yes      | Same Twilio account as the web app; validates the media handshake and account binding. |
| `OPENAI_API_KEY`                           | Yes      | Server-only OpenAI project key with Live and Responses access.                         |
| `AI_PHONE_LIVE_MODEL`                      | No       | `gpt-live-1`; must match the web app. Previews use this exact model.                   |
| `PORT`                                     | No       | `8080`.                                                                                |
| `MAX_CONCURRENT_CALLS`                     | No       | `50`; additional connections are refused.                                              |
| `VOICE_IDLE_SECONDS`                       | No       | `60`; end an idle call independently of backend activity.                              |
| `VOICE_VAD_THRESHOLD`                      | No       | `900`, decoded PCM RMS; tune with real telephone noise.                                |

For development, build `@louez/voice` first, then run
`pnpm --filter @louez/voice-relay dev` to restart on TypeScript source changes.

Secrets are not read from a checked-in file. Use your deployment's secret store
or export a private environment file before starting the worker.

## Deploy

```sh
docker build -f apps/voice-relay/Dockerfile -t louez-voice-relay .
docker run --rm -p 8080:8080 --env-file /path/to/private/voice.env louez-voice-relay
```

For Fly.io, set the app name and region in `fly.toml`, provision the environment
above with `fly secrets set`, and run from the monorepo root:

```sh
fly deploy --config apps/voice-relay/fly.toml
```

Use TLS termination supporting WebSocket upgrades and long-lived connections.
Keep at least one worker running; rolling deploys should drain active calls.
Place the worker near the web app and the chosen telephony region. GPT-Live uses
the OpenAI project's configured service availability; moving this worker alone
does not establish regional processing or data residency.

## Endpoints and authentication

- `GET /health`: process readiness only; it does not make a paid OpenAI call.
- `WSS /media`: validates `X-Twilio-Signature` against the configured public
  origin, then validates a five-minute HMAC bound to the conversation and CallSid
  from `start.customParameters`. A durable stream/connection claim prevents replay.
- `POST /preview`: signed internal request; fixed localized sample only, known
  voice IDs only, ten-second generation, two concurrent generations, bounded cache.
- Worker → app: timestamped HMAC over method, path and raw JSON. The app checks
  the call, conversation, stream, connection and current store permissions.

## Audio and lifecycle

Both call transports use raw G.711 μ-law at 8 kHz. No transcoding, WAV headers or
separate STT/TTS API is involved. Audio starts only after `session.started`.
The worker forwards continuous input, including silence. A local energy gate
clears Twilio's pending playback after sustained caller speech; GPT-Live manages
the conversational interruption itself. The threshold needs telephone testing.

Backend function calls come from nested `response.output_item.done`, not a
transcript fragment or the empty `response.completed.output` array. Results for
all pending tools are submitted before `response.create` continues the backend.
The app validates tools and arguments again and persists claims before writes.

Audio buffers, tool count, response count, call duration and concurrency are
bounded. Shutdown requests `session.close`, waits up to 15 seconds for final
usage and records whether it was confirmed. The upstream socket closes before
app persistence, and a ten-second deadline releases Twilio if the app is down. Usage snapshots are cumulative;
they must never be summed. The app's minute cron reconciles abandoned sessions
using only their last observed usage.

Transcripts are generated captions with approximate timestamps, not proof that
every word reached the caller. Twilio marks acknowledge playback; cleared marks
are discarded. No transcript, audio or tool argument is written to worker logs.

## Tests

```sh
pnpm --filter @louez/voice test
pnpm --filter @louez/voice-relay test
```

The integration tests run local WebSocket peers for Twilio and OpenAI. They do
not require keys, place calls or incur API costs. A real telephone acceptance
test is still required to check voice quality, barge-in, carrier timing,
disclosures, transfer and provider account access before production activation.

## Related

- [Deployment and migration guide](../../docs/ai-phone-receptionist.md)
- [OpenAI Live WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
- [OpenAI delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
