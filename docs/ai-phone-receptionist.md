# AI phone receptionist — GPT-Live

The phone receptionist uses **OpenAI GPT-Live** for live speech and an OpenAI
Responses model for reasoning and tools. Twilio supplies phone numbers, PSTN,
optional recordings and transfers. The storefront text advisor can still use
its own `AI_PROVIDER`: changing that setting does not change the phone agent.

## Architecture

```text
Caller → Twilio <Connect><Stream> → voice-relay → OpenAI Live
                                       ↕            ↕
                          signed /api/voice/live   Responses backend
                                       ↕
                          store-scoped Louez services
```

`apps/voice-relay` handles persistent WebSockets, PCMU audio, interruptions,
function-call transport and bounded voice previews. `packages/voice` contains
the shared wire contracts, HMAC helpers and public voice catalog. The web app
authorizes every session and tool against its store, calls the existing catalog,
quote and reservation services, and persists transcripts, usage and outcomes.

The model never calculates an authoritative price or availability. A reservation
write requires a recent successful quote for the same items and an explicit
caller-confirmation argument. Every write is claimed durably before execution;
uncertain writes are not retried. At most one successful booking is created per
call. It remains a pending request for the store to confirm. An SMS is promised
only when the SMS provider reported success.

## Configuration

1. Apply the committed DB migrations, including `0080_gpt_live_voice.sql`.
2. Deploy the [worker](../apps/voice-relay/README.md) with a private OpenAI project
   key that can access GPT-Live and the selected Responses model.
3. Configure the web app:

| Variable                                  | Meaning                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `AI_PHONE_ENABLED=true`                   | Enables the optional phone feature.                                     |
| `VOICE_PROVIDER=twilio`                   | Telephony provider.                                                     |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Signature validation and telephony management.                          |
| `VOICE_RELAY_WS_URL`                      | Public worker origin, e.g. `wss://voice.example.com`. No path or query. |
| `VOICE_RELAY_SIGNING_SECRET`              | Shared random secret, minimum 32 characters.                            |
| `AI_PHONE_LIVE_MODEL`                     | Defaults to `gpt-live-1`; match the worker's preview model.             |
| `AI_PHONE_BACKEND_MODEL`                  | Defaults to `gpt-5.6-luna`; must support Responses tools.               |
| `AI_PHONE_DEFAULT_VOICE`                  | Optional valid preset overriding language recommendations.              |
| `AI_PHONE_MAX_CALL_SECONDS`               | Hard audio-session limit, default 600, maximum 3600.                    |
| `TWILIO_ADDRESS_SID`, `TWILIO_BUNDLE_SID` | Optional regulatory identifiers for number provisioning.                |

4. Configure the Twilio number to POST incoming calls to
   `https://<app>/api/voice/incoming` and status changes to
   `https://<app>/api/voice/status`. Existing provisioned numbers already use
   these URLs. WebSocket upgrades must reach the worker's `/media` endpoint.
5. Enable the store's phone agent on an eligible plan. Choose language, voice,
   greeting, booking permissions, answer mode and optional transfer/recording.
6. Keep the authenticated `/api/cron` minute job running for abandoned-session
   reconciliation and existing number renewals.

The standard AI disclosure and any recording notice are spoken deterministically
by Twilio before the generative session. GPT-Live speaks the configured greeting
and the conversation. Fixed outage messages also use Twilio so an OpenAI outage
cannot suppress the fallback. These short messages use the language's Polly
voice, not the selected Live preset.

## Voice selection

The dashboard offers the 31 documented public multilingual Live presets, with **Brise** recommended
for French and **Sillage** as another French option. Recommendations also exist
for German, Portuguese and English. A preset's regional influence is not a
language restriction: preview it in the store's selected language.

Previews use the same Live model and voice as calls, with a fixed localized
greeting. They are permission-checked, rate-limited, bounded to ten seconds and
cached by preset/language/model. Generation is billable to the operator's OpenAI
project, separate from customer call credits. No API key reaches the browser.

## Migrating from ConversationRelay / Gather

Deploy the migration, app and worker together after draining current calls.
There is no automatic fallback to the old speech pipeline.

- Removed: `/api/voice/turn`, `/api/voice/respond`, `/api/voice/relay-action`,
  ElevenLabs discovery/previews and the old AI SDK phone turn loop.
- New: signed `/api/voice/live`, signed Twilio `/api/voice/stream-action`,
  `voice_session` and `voice_tool_execution` tables.
- Remove `AI_PHONE_TRANSPORT`, `AI_PHONE_MODEL`, `TURN_ENDPOINT_URL`,
  `AI_PHONE_TTS_PROVIDER`, `AI_PHONE_STT_PROVIDER`, `AI_PHONE_VOICES`,
  `AI_PHONE_VOICE_CATALOG`, `AI_PHONE_RECOMMENDED_VOICES`, `ELEVENLABS_API_KEY`.
- Old stored voice IDs are safely resolved to a valid recommendation. The form
  explains the change; saving replaces the old value. Existing transcripts,
  numbers, business settings and recordings are preserved.
- Replace any old `AI_PHONE_DEFAULT_VOICE` with a supported preset or unset it.
- Build/deploy the worker **from the monorepo root**, including `packages/voice`.

Rollback: disable new calls, drain active sessions, redeploy the previous app
and worker together, and restore the previous private environment. The added
tables can remain; the migration does not delete or rewrite existing records.
Voices saved as Live presets must be reselected for an old ElevenLabs deployment.

## Usage and billing

There are distinct costs: Live session seconds, delegated Responses tokens,
Twilio transport, number rental, worker hosting and any transferred human leg.
No provider rate or commercial margin is hardcoded.

`session.closed.usage.seconds` confirms audio duration. Interim usage snapshots
are cumulative and never added together. The full Twilio duration is retained
on the conversation; per-response token usage and the model/voice snapshot are
also retained when customer credits are disabled. PSTN duration is not used to bill GPT-Live time after a human transfer.
If finalization is lost, only the observed lower bound is settled and
`usage_finalized=false` remains available for operator reconciliation.

Configure `AI_VOICE_AUDIO_USD_PER_MIN` for the combined Live and transport cost
during the AI portion. This is a configured cost estimate, not a Twilio invoice
import. Set separate `AI_PHONE_INPUT_USD_PER_MTOK`,
`AI_PHONE_OUTPUT_USD_PER_MTOK`, `AI_PHONE_CACHED_INPUT_USD_PER_MTOK` for the chosen
Responses model; the advisor's token rates are not reused.

The existing `AI_PHONE_CREDITS_PER_MINUTE` flat customer tariff remains optional.
Otherwise the configured USD cost basis and per-call credit cap apply. A flat
tariff must cover at least one started minute to accept a new call; duration is
bounded by the available balance and rechecked during the call. Concurrent calls
and other credit-consuming features share the wallet; the gate is not a credit
reservation system. Keep account-level provider limits as well as call limits.

## Failure handling and operations

- Twilio signatures and short-lived call-bound HMACs are both validated.
- The app claims a stream and a worker-generated connection ID once. It scopes
  all tool requests to that call and its store, with current feature checks.
- A five-minute quote gate, serialized write claims and cached results protect
  against duplicate bookings after retries. An unresolved tool operation is
  handed off for human follow-up; do not blindly re-run it.
- A worker failure transfers to the configured human number when possible,
  otherwise plays an unavailable message and ends the call.
- The hard duration timer runs independently of caller turns or silence.
- Session storage at OpenAI is set to `false`. This does not change the API's
  applicable retention policy. Optional Twilio recording still follows the
  store setting. New application metadata is erased with store account deletion.
- Generated transcript fragments are approximate captions, not a guaranteed
  record of heard speech. Interrupted audio may still appear in those captions.

For uncertain operations, inspect `voice_tool_execution.status='started'` and
the associated reservation before manual action. For incomplete usage, inspect
`voice_session.usage_finalized=false` and reconcile with provider logs. Never
infer a successful booking from spoken text alone.

## Validation before enabling production calls

Automated checks: shared authentication/catalog tests; worker protocol tests;
local WebSocket integration for audio, interruption and cumulative usage;
TypeScript checks; schema migration generation. No paid API is used by tests.

Test a real staging number for French names/dates/prices, noise and barge-in,
voice preview consistency, successful and refused bookings, changed dates,
duplicate callbacks, disconnect during a tool, transfers, exhausted credits,
maximum duration, recording disclosure and a worker restart. Check actual
reservations, usage rows and heard audio together. Compare latency and task
completion against recorded baseline calls before claiming a quality gain.

## Related

- [Worker deployment](../apps/voice-relay/README.md)
- [Module ownership](architecture/module-ownership.md)
- [Backend conventions](from-scratch/04-backend.md)
- [Security review](code-review/06-security.md)
- [OpenAI Live sessions](https://developers.openai.com/api/docs/guides/live-conversations)
- [OpenAI delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [OpenAI pricing](https://openai.com/api/pricing/)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
