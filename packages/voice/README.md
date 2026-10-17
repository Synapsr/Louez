# @louez/voice

Shared transport code for the Next.js app and the GPT-Live worker. No database,
provider credentials, business operations or application imports belong here.

- `@louez/voice/catalog`: browser-safe public presets and fallback resolution.
- `@louez/voice/protocol`: Zod schemas for the signed worker/app boundary.
- `@louez/voice/auth`: Node-only HMAC helpers; never import in a client component.

This package compiles to `dist` because the worker runs directly on Node. Turbo
builds it before dependent applications. For targeted commands, run
`pnpm --filter @louez/voice build` first. Tests: `pnpm --filter @louez/voice test`.

## Related

- [Architecture](../../docs/ai-phone-receptionist.md)
- [Worker](../../apps/voice-relay/README.md)
