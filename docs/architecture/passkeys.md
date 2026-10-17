# Management account passkeys

Passkeys are an additional sign-in method for Louez management accounts. Storefront customer sessions are independent and do not use this feature.

## Deployment

Apply `packages/db/src/migrations/0079_passkeys.sql` through the normal migration runner before serving the new application. It adds the `passkey` table and expands `verification.value` to `text` for WebAuthn challenge payloads. Docker installations run committed migrations at startup.

`AUTH_URL` must match the public management origin, including the port in local development. No additional variable or external service is required. Browsers require HTTPS, except for trusted loopback origins such as `http://localhost:3000`.

The relying-party ID is the hostname of `AUTH_URL`, without a port. It deliberately does not include sibling storefront subdomains. Changing the management hostname requires users to register new keys; keep an existing sign-in method available during a domain move. Builds can omit runtime configuration; an empty origin allowlist prevents verification if `AUTH_URL` is still missing at runtime.

## Experience

- After a recent Google or email sign-in, users without a registered key receive an optional card at the bottom right on compatible, secure browsers. It does not take focus or block the dashboard; its action opens the browser's native creation flow directly. A built-in platform authenticator is not required: the browser can offer a synced provider, phone, or security key.
- The invitation waits for onboarding, dialogs, notifications, and form editing to finish. It retries when the screen is available and expires with the ten-minute enrollment window. Choosing “Later” suppresses it for 30 days per account/browser; simply displaying it does not consume the invitation. Keys can always be added or removed from the account page.
- After successful registration or passkey sign-in, this browser remembers a boolean preference and offers passkeys first. Other sign-in methods remain accessible. On another browser, the passkey button is available without requiring an email lookup.
- WebAuthn does not expose a silent inventory of the device's credentials. The local preference is only a presentation hint. The browser's native chooser and the server verification determine whether an actual credential is usable. No OS authentication dialog is triggered without a click.
- Removing the last key clears this browser's preference. Removal revokes the credential at Louez; users can separately remove its copy from their credential manager. It does not sign out existing sessions.

## Security boundaries

The official Better Auth passkey plugin owns challenge generation, signed challenge cookies, single-use challenge consumption, signature verification, counters, and session creation. The plugin is pinned to `1.6.25` and uses the existing database-backed rate limiter.

`packages/auth/src/passkey.ts` additionally enforces:

- Exact expected origin and relying-party hostname, never an origin taken from the caller.
- Discoverable credentials and user verification. The plugin's internal verifier uses `requireUserVerification: false` in this version; both `afterVerification` callbacks therefore require the verified `userVerified` flag before persisting a key or creating a session. Authentication options request `required` as well.
- An authoritative database session for key management and listing, bypassing the five-minute cookie cache. Registration, deletion, and rename require a session created within the last ten minutes. The UI offers sign-out and reauthentication when that window expires.
- Bounded labels; credential ownership is checked by the plugin. Keys belong to users, not individual stores, just like other management sign-in methods.

Credential IDs have a unique, case-sensitive ASCII index. Only public keys and credential metadata are stored. Account deletion cascades to the user's passkeys. Private keys and biometric data never reach Louez.

When upgrading Better Auth, recheck both verification callbacks and the authentication-options hook against the installed plugin implementation.

## Validation

From `apps/web`, using Node 22 or later:

```sh
node --import tsx --test ../../packages/auth/src/passkey.test.ts \
  ../../packages/auth/src/rate-limit.test.ts \
  components/auth/util.passkey-preferences.test.ts \
  lib/utils/util.sign-in-method.test.ts
```

The tests use isolated in-memory accounts and signed WebAuthn responses. They cover enrollment, authentication, origin/signature/challenge rejection, missing user verification, replay, expired challenges, stale/revoked sessions, ownership, labels, and preference fallback. They require no business database or email transport. Run the normal translation checks, `pnpm lint`, `pnpm type-check`, and production build as well.

## Related

- [Authentication and backend conventions](../from-scratch/04-backend.md)
- [Security review rules](../code-review/06-security.md)
- [Module ownership](module-ownership.md)
- [Better Auth passkey plugin](https://www.better-auth.com/docs/plugins/passkey)
- [WebAuthn specification](https://www.w3.org/TR/webauthn-3/)
