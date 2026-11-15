# louez

Louez on the command line. Every operation of the [Louez REST API](https://app.louez.io/api/v1/docs) is a command, generated from the API's OpenAPI document: list reservations, record a payment, update a product, from a terminal or from an agent with a shell, with an API key.

The API is in beta, and so is this CLI: operations and their flags may still change. Each change is announced in the [Louez changelog](https://github.com/Synapsr/Louez/blob/main/CHANGELOG.md).

## Install

Node.js 20 or later. The package has no runtime dependency.

```sh
npm install --global louez
```

From this repository, before it is published:

```sh
pnpm install
pnpm --filter ./packages/cli build
node packages/cli/dist/bin.js --help
```

## Authenticate

Create an API key in the Louez dashboard, under Settings > Integrations > MCP, in the API keys section. Choose what the key may read and change; it works on its store only.

```sh
louez auth login        # paste the key: it is checked, then saved
louez auth status       # the store the key belongs to, and where the key comes from
louez auth logout       # removes the saved key
```

`louez auth login` also reads the key from standard input (`printenv MY_KEY | louez auth login`). It saves it in `config.json` under `$XDG_CONFIG_HOME/louez`, or `~/.config/louez` (on macOS too), or `%APPDATA%\louez` on Windows. The file is readable by you alone (0600).

The key is found in this order: `--api-key`, then `LOUEZ_API_KEY`, then the saved key. In CI or in an agent's environment, set `LOUEZ_API_KEY`.

The base URL defaults to `https://app.louez.io/api/v1`. For a self-hosted Louez, set `LOUEZ_API_URL` or pass `--api-url` (with `louez auth login`, it is saved with the key).

## Commands

```text
louez <group> <action> [arguments] [flags]
louez <operationId> [arguments] [flags]
louez api <METHOD> <path> [--json <body>]
```

- **The group** is the operation's group in the API reference, in kebab-case: `reservations`, `payments`, `seasonal-pricing`, `online-store`.
- **The action** is the operation's id without the group's words: `reservations_list` is `louez reservations list`, `record_payment` is `louez payments record`, `products_list_units` is `louez units list`. When that would leave nothing, or two operations of a group would meet, the action is the whole operation id in kebab-case.
- **The operation id** works too, as a command of its own: it is also the name of the operation's MCP tool (`louez reservations_list`).
- **Path parameters** are positional arguments, in the path's order: `louez reservations get res_123`.
- **Query parameters and body fields** are flags in kebab-case: `categoryIds` is `--category-ids`. A boolean is `--flag`, `--flag=false` or `--no-flag`; a list repeats its flag or takes a JSON array; an object takes JSON; `null` clears a field that may be null.
- **`--json`** gives the whole body (the query, for a GET): inline, `@file`, or `-` for standard input. Flags set fields over it.
- **`louez api`** sends any operation by its method and path, query included.

`louez --help`, `louez <group> --help` and `louez <group> <action> --help` describe each command from the API's own reference.

## Output and exit codes

The answer's JSON goes to standard output, and nothing else: indented on a terminal, on one line when piped. Errors go to standard error, as the API's error JSON followed by one line for a person.

| Code | Meaning                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The call succeeded.                                                                                                                                            |
| 1    | The API refused or failed (its `data.code` says why), or it answered a redirect.                                                                               |
| 2    | The command line is wrong: an unknown command or flag, a missing value, no API key, an `http://` base URL.                                                     |
| 3    | A person must act first: a write waits for an approval (`APPROVAL_REQUIRED`, `APPROVAL_PENDING`) or for its preview to be confirmed (`CONFIRMATION_REQUIRED`). |
| 4    | Louez could not be reached, or did not answer in time (`--timeout`, 120 seconds by default).                                                                   |

## Examples

**Today's pending requests**, one line each:

```sh
louez reservations list --status pending --period today | jq -c '.items[]'
```

**Active products of two categories** (a list flag repeats):

```sh
louez products list --status active --category-ids cat_tents --category-ids cat_bikes
```

**A product from a file**, with one field changed on the command line:

```sh
louez products create --json @tent.json --status draft
```

**A note on a reservation**, the body from standard input:

```sh
echo '{"notes":"Customer brings their own helmet."}' | louez reservations update-notes res_123 --json -
```

**A payment, which the key's owner approves.** Recording a payment needs the approval of the key's owner, whatever the key's settings. The first call does nothing and exits 3 with the link to give them:

```console
$ louez payments record res_123 --type rental --amount 150.00 --method cash
{"defined":true,"code":"PRECONDITION_FAILED","status":412,"message":"…","data":{"code":"APPROVAL_REQUIRED",…}}
louez: this write needs a person's approval. Nothing was done. Open:
  https://app.louez.io/handoffs/…
Once it is approved, run:
  louez payments record res_123 --type rental --amount 150.00 --method cash --confirmation apr_…
Or run the same command with --wait to wait for the decision.
```

Once they approved it on that page, the printed command carries the payment out, once. With `--wait`, the CLI reads the approval every 30 seconds (the reference's interval, or longer when the answer asks), then carries the payment out as soon as it is approved, or stops at a refusal or at expiry:

```sh
louez payments record res_123 --type rental --amount 150.00 --method cash --wait
```

## Safe retries

Every write the API lets repeat is sent with an `Idempotency-Key`: yours with `--idempotency-key`, or a new one per command. If the network fails before the answer, the CLI prints the key it used: run the same command again with `--idempotency-key <that key>`, and Louez answers with the first call's outcome instead of running it twice. The CLI never sends a write again by itself; `--wait` sends it a second time only once a person approved it.

## Security

- The key is sent only to the base URL's origin, in the `Authorization` header: never in a URL, never printed, never logged. `louez auth status` says where it comes from, not what it is.
- The CLI never follows a redirect, which would take the key to another server: a 3xx answer exits 1.
- The base URL must be `https://`, except on `localhost`, `127.0.0.1`, `[::1]` or a `.localify` host; anything else needs `--insecure`.
- The command printed for an approval never holds the key: a key given with `--api-key` is printed as `"$LOUEZ_API_KEY"`.

## Development

The commands come from `src/manifest.generated.ts`, generated from the OpenAPI document of `@louez/api` and committed. After changing the API:

```sh
pnpm --filter ./packages/cli generate
```

`pnpm --filter ./packages/cli test` fails when the committed manifest is not the one the API generates, so CI's tests catch an API change without a regenerated CLI. The tests never leave 127.0.0.1: a fetch elsewhere fails the run.

The package must not import `@louez/api` at run time: the published CLI is standalone, and `@louez/api` is a development dependency, used only by the generator.
