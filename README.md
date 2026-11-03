# BlockVectra AI Agent Quickstart (TypeScript)

A TypeScript example for AI agents and automated scripts. Start with a keyless public RPC read: use Robinhood mainnet by default, or select an EVM chain by its chain ID. No wallet, account, or API key is required for this step. When you need the Data API or an account, continue to the full SIWE onboarding flow below.

## Ask a documentation question with an Agent Skill

For documentation help without running the TypeScript example, install the [BlockVectra documentation skill](skills/blockvectra-docs/SKILL.md) in an Agent Skills-compatible client. The pinned installer requires Node.js >= 22.20.0. From your project directory, choose the command for your agent; both install to the current project without confirmation prompts:

```bash
# Codex
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent codex --yes

# Claude Code
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent claude-code --yes
```

Try: "Use blockvectra-docs to explain Robinhood mainnet public RPC setup and cite the source." The skill uses configured MCP documentation tools or an available HTTP reader. It needs no BlockVectra account or key and does not run RPC or the SIWE onboarding example. It contains instructions, not a bundled model or MCP server.

The installer collects anonymous installation telemetry by default; set `DISABLE_TELEMETRY=1` to opt out. See the [installer documentation](https://github.com/vercel-labs/skills#telemetry).

## Start with a keyless read

With Node.js 22 (>= 22.18) or Node.js >= 24.12, and git, run the keyless reader directly without installing dependencies:

```bash
git clone https://github.com/blockvectra/agent-quickstart.git
cd agent-quickstart
node src/public-read-cli.ts
```

To select another EVM chain, pass its decimal chain ID:

```bash
node src/public-read-cli.ts 56  # BSC mainnet
node src/public-read-cli.ts 1   # Ethereum mainnet
node src/public-read-cli.ts 57073  # Ink
node src/public-read-cli.ts 130    # Unichain
node src/public-read-cli.ts 252    # Fraxtal
# With the npm entry: npm run read:public -- 56
```

Omitting the argument keeps Robinhood mainnet (`4663`). The selected chain must appear exactly once in the current directory and advertise both public read methods. The reader checks the returned chain ID against your argument before fetching a block number; it stops if the chain or keyless policy is unavailable.

Node's [built-in TypeScript support](https://nodejs.org/docs/latest-v22.x/api/typescript.html) runs this entry without a build or npm installation. For other Node.js versions, use the existing npm path after cloning:

```bash
npm ci --ignore-scripts
npm run read:public
```

The command reads the public chain directory, confirms the selected chain’s exact public endpoint and required methods, then serially reads the chain ID and latest block number. The whole check uses at most three HTTP requests: the directory plus two JSON-RPC calls. No wallet, account sign-up, or API key is involved. If the directory stops advertising the public endpoint or the required methods, it stops before any RPC. Data API and account operations still need an API key, and the full onboarding flow below remains available.

If a request fails with an HTTP status or times out, the command identifies the directory or RPC method involved and exits with code `1`. For HTTP `429`, wait before trying again manually. The command does not retry automatically and does not print response bodies or raw exceptions. Other failures use a generic error message. Successful runs print the same JSON result.

Beyond the keyless read, the full example covers:
1. **Wallet identity**: Reads an Ethereum EOA private key from `AGENT_PRIVATE_KEY` or from a local `.agent-wallet.json` file. If neither is configured, generates a new wallet locally and saves it to `.agent-wallet.json` (permission `0600`) so subsequent runs reuse the same identity instead of creating new accounts.
2. **Programmatic account sign-up**: Authenticates via Sign-In with Ethereum (SIWE / EIP-191) against `https://console-api.blockvectra.com/v1` in programmatic mode (omitting the `Origin` header). First-time wallet sign-in automatically provisions an account.
3. **API key provisioning**: Reuses `.agent-key.json` for the same wallet, or creates and saves one key with private `0600` permissions. `BLOCKVECTRA_API_KEY` takes precedence without reading or changing the saved key.
4. **JSON-RPC execution**: Reads the active chain directory from `GET https://api.blockvectra.com/v1/chains`, selects the unique `robinhood_mainnet` entry with numeric chain ID `4663`, verifies `eth_chainId` on that endpoint, then executes `eth_blockNumber` using the API key.
5. **Data API query**: Calls the read-only dataset freshness endpoint (`GET /v1/data/{chain}/status/freshness`) defined in the OpenAPI specification.

## Server-side: scope a private RPC header

Use [createHeaderScopedRpcFetch](examples/header-scoped-rpc-fetch.mjs) with a server-side `makeRpc` client that accepts `fetcher(stringUrl, requestInit)`. Choose the private endpoint from the public chain directory (`GET https://api.blockvectra.com/v1/chains`) and keep your existing chain choice; `robinhood_mainnet` and `eth_mainnet` are examples, not defaults. In your module that already imports `makeRpc` and defines `existingRpcOptions` (primary/fallback):

```js
import { createHeaderScopedRpcFetch } from './examples/header-scoped-rpc-fetch.mjs';

const endpoint = 'https://api.blockvectra.com/v1/robinhood_mainnet';
const fetcher = createHeaderScopedRpcFetch({
  endpoint, // Must equal your configured primary URL exactly.
  apiKey: 'synthetic-only-replace-via-server-secret-manager',
});
const rpc = makeRpc({ ...existingRpcOptions, fetcher });
```

The key above is fake; inject the real value through your server's secret manager. Never put it in URLs, logs, browser code or fallback configuration. Only the exact endpoint gets `x-api-key`. Other headers, method, body and AbortSignal survive; caller `x-api-key` or `Authorization` is rejected for `Headers`, tuples and objects. Redirects always fail, even with caller `follow`; there are no retries, body reads, response wrappers or added URL parameters, including on 429.

Configuration rejects credentials, explicit ports, query/fragment and public suffixes; the endpoint must be literal `https://api.blockvectra.com/v1/<slug>` (lowercase letters/digits, `_` or `-` separators). Keys must be nonempty printable ASCII without surrounding whitespace; validation happens before requests, with fixed errors that omit the key. Strings match verbatim, so normalized path/query/fragment tricks gain no authorization. `URL` objects use a native normalized serialization snapshot; information already lost in `new URL(...)` cannot be recovered. `Request` is unsupported.

This only wires headers safely on the server; it is not a generic credential scrubber, browser helper or complete SDK. Other caller credentials remain your responsibility. A custom `fetchImpl` must be trusted and honor `redirect: 'error'`. Tests use synthetic keys and loopback HTTP with test-only URL mapping, not Prod DNS/TLS. Chain capability, chain ID, usage and actual scans (including a 24-hour scan) remain unverified.

## Add builder context with HEY

After the keyless chain read, you can fetch a separate [HEY builder card](https://heyresearch.xyz/developers/partners) to see the project's latest reported ship and its sources. With `curl` available, this example uses the Ekubo token on Robinhood Chain:

```bash
hey_card_response="$(curl --silent --show-error --max-time 15 --max-filesize 131072 \
  --header 'x-hey-integration: blockvectra-partner-example/0.1.0' \
  --write-out '\n%{http_code}' \
  'https://heyresearch.xyz/api/v1/builder?chain=4663&token=0x570c5aa79c798e7a418412cc8399ae5bcce570c5')" || exit
hey_card_status="${hey_card_response##*$'\n'}"
hey_card_body="${hey_card_response%$'\n'*}"
case "$hey_card_status" in
  200) ;;
  404) printf '%s\n' 'HEY returned 404; the separate chain read is unchanged.' >&2 ;;
  *) printf 'HEY request returned HTTP %s\n' "$hey_card_status" >&2; exit 1 ;;
esac
printf '%s\n' "$hey_card_body"
```

HTTP `404` with `error: "not_found"` means HEY has no published project for that contract. Follow its returned `scan_url` if needed; this does not invalidate the separate RPC result.

Keep HEY's `as_of` and activity timestamps separate from the time of your chain read. Use the returned `project_link` for the source context. When `activity_applies_to_token` is `false`, the activity is project-level; when `activity_measured` is `false`, activity is unmeasured, not zero. A block number does not verify the builder card.

---

## Architecture and Programmatic Workflow

```
+-------------------------------------------------------------+
|                     Local Agent Runtime                     |
|                                                             |
|  1. Generate / load Ethereum EOA wallet (viem)              |
|  2. Sign SIWE challenge locally with EIP-191 personal_sign  |
+------------------------------+------------------------------+
                               |
                               | (HTTP POST, no Origin header)
                               v
+-------------------------------------------------------------+
|              BlockVectra Control Plane (console-api)        |
|                                                             |
|  - POST /auth/siwe/challenge -> Issues nonce & SIWE message |
|  - POST /auth/siwe/login     -> Verifies signature & issues |
|                                 session token (rgs_...)     |
|  - POST /keys                -> Generates API key (rgw_...) |
+------------------------------+------------------------------+
                               |
                               | (Authenticated with x-api-key)
                               v
+-------------------------------------------------------------+
|               BlockVectra Data Plane (Gateway)              |
|                                                             |
|  - GET  /v1/chains           -> Public chain directory      |
|  - POST /v1/{chain}          -> Chain-scoped JSON-RPC       |
|  - GET  /v1/data/{chain}/... -> REST Data API endpoints     |
+-------------------------------------------------------------+
```

### Key Security Principles

- **Local private keys**: Private keys never leave the local environment and are never transmitted to any API endpoint or conversational context.
- **Header-based key authentication**: API keys are passed exclusively via request headers (`x-api-key` or `Authorization: Bearer`).
- **No secret leakage in logs**: Private keys, session tokens, and API keys are never printed in plaintext (only truncated prefixes such as `rgw_54dd...` appear in diagnostic output).
- **Wallet-bound account recovery**: An agent's account identity is bound to its Ethereum wallet address. If a session token or API key is lost, signing in again with the same wallet restores access to manage or revoke existing keys.

---

## Prerequisites

- Node.js >= 18.0.0
- npm
- git

---

## Installation & Setup

1. Clone the repository and enter the directory:

   ```bash
   git clone https://github.com/blockvectra/agent-quickstart.git
   cd agent-quickstart
   ```

2. Install dependencies from the lockfile:

   ```bash
   npm ci --ignore-scripts
   ```

3. (Optional) Configure an existing wallet by injecting `AGENT_PRIVATE_KEY` into the process environment through your runtime's secret manager. `.env.example` documents its format; `npm start` does **not** load a `.env` file automatically.

   Without this override, the script reuses `.agent-wallet.json`. It creates a wallet only when that file is absent, using an exclusive write and permission `0600` on POSIX filesystems. An unreadable, damaged or inconsistent wallet stops execution before sign-in and is never overwritten. Preserve the file and restore a trusted backup before retrying; deleting it creates a different identity on the next run. The private key is never printed to the console.

---

## Running the Quickstart

Execute the TypeScript entrypoint directly using `tsx`:

```bash
npx tsx src/index.ts
```

Or run via npm script:

```bash
npm start
```

The block-number check requires HTTP success, a matching JSON-RPC response and a valid Ethereum block quantity. Rejected responses stop before the Data API step; valid explicitly retryable errors have at most five attempts per RPC method (up to ten across chain-ID and block-number verification). See [JSON-RPC responses](https://www.jsonrpc.org/specification#response_object) and [Ethereum quantities](https://eips.ethereum.org/EIPS/eip-1474#quantity).

Whole-request errors with `id: null` may be retried when explicitly marked retryable; a successful response must still match request ID `1`.

This mainnet example does not select a network by display-name similarity or fall back to testnet. Missing, duplicate or inconsistent mainnet directory entries stop before RPC. A valid `eth_chainId` result must equal `4663` before the script requests a block number or Data API freshness. This adds one read-only RPC call on a successful run; chain verification may fail after wallet/account/key provisioning has already occurred.

Every HTTP request in the full onboarding flow has a 15-second deadline, including response-body reads. A timeout stops the run without retrying that request. It does not prove that the server did not perform a sign-in or key creation; if either request times out, check with the same wallet in Console before rerunning.

The Data API freshness request uses a 15-second timeout with no retry. A response is consumed only when HTTP succeeds, the JSON envelope is an object, `meta.chain` equals the selected `robinhood_mainnet`, `data` is an array, and every row has a string `dataset` with `max_block_number` and `seconds_behind` each an integer or `null`. Unexpected rows stop the run with a local error that preserves the HTTP status but not the upstream body. Empty lists, zero, negative, `null` and extra fields are accepted. This check only proves the request flow and the consumed fields; it does not establish that every dataset is fresh, stale-free or complete, and a `null` value is logged as unknown rather than zero.

Run `npm test` and `npm run typecheck` for offline regression checks. Tests replace network calls and do not provision accounts.

Pull requests and pushes to `main` run these checks on Node.js `24.21.0` through [Offline checks](.github/workflows/offline-checks.yml), after installing the lockfile dependencies with `npm ci --ignore-scripts`.

---

### Reuse the created API key

The full onboarding run saves the API key and key ID in `.agent-key.json`, bound to the wallet address. Later runs in the same directory reuse it and skip sign-in and key creation. The key survives a later RPC/Data API failure, so rerunning does not silently create another one. Keep this git-ignored file private and load `api_key` through your server or Agent runtime's secret manager; never paste it into chat or client code.

A damaged, overly permissive or different-wallet file stops before sign-in and is not overwritten. An expired or revoked saved key is not automatically replaced: manage it using the same wallet, then deliberately replace the local file or inject `BLOCKVECTRA_API_KEY`. If saving a newly created key fails, the example attempts to revoke that key and reports only its ID and whether the revoke request was accepted. This is local persistence, not a remote key-status check.

## Optional: Read Wallet Balances (library, not run by `npm start`)

`src/wallet-balances.ts` is an opt-in, read-only helper for `GET /v1/data/{chain}/addresses/{address}/balances`. `collectBalancePages(readPage, expectedChain, maxPages = 20)` follows `next_cursor` until it is omitted and rejects on malformed envelopes, chain mismatch, HTTP/read failures, repeated cursors, the page cap, duplicate tokens, or a changed known `meta.refreshed_at`. Balances stay exact decimal-integer strings; `symbol`/`decimals` stay `null` when unknown (`decimals: 0` is a real value). `readPage` must reject HTTP errors before returning JSON. Run it server-side only; the API key must not reach browsers or logs.

```ts
import { collectBalancePages } from "./src/wallet-balances.js";

const chain = "robinhood_mainnet"; // check chain capability/coverage first
const address = "0x..."; // wallet to read

const result = await collectBalancePages(async (cursor) => {
  const url = new URL(`https://api.blockvectra.com/v1/data/${chain}/addresses/${address}/balances`);
  if (cursor !== undefined) url.searchParams.set("cursor", cursor); // opaque, unchanged
  const res = await fetch(url, { headers: { "x-api-key": process.env.BLOCKVECTRA_API_KEY! } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}, chain);
```

Before real use, confirm the selected chain's capability and coverage for this endpoint; this repository makes no claim that Robinhood balances are currently available and has not run this against a live API. Balances come from a snapshot refreshed every 6 hours (plus up to 30 minutes of delay and the refresh run), so rows may be stale. `meta.as_of_block` is the indexed head, not the snapshot height; read `meta.refreshed_at` (`null` means unknown, treat as stale). Pages are not a transactionally consistent portfolio; `pages` keeps each page's original `meta`. The aggregate `refreshedAt` is the shared known time only when every page reported the same one; if any page has `refreshed_at: null` it is `null` (unknown), regardless of page order, and differing known times are still rejected even with a `null` page between them.

---

## Example Output

Illustrative output (addresses, keys, block heights and dataset counts vary; this revision was validated offline):

```text
=== BlockVectra AI Agent Quickstart ===

[1/5] Generated agent wallet and saved to .agent-wallet.json (0600).
      Tip: Set AGENT_PRIVATE_KEY in your environment to override.

      Wallet Address: 0x...

[2/5] Requesting SIWE challenge...
      Signing verbatim challenge message with EIP-191...
      Submitting SIWE login...
      Account Created: true
      Session Token: rgs_4f5b...

[3/5] Provisioning API key...
      Key ID: k_xxxxxxxxxxxx
      API Key saved to .agent-key.json (0600). Keep this file private.

[4/5] Reading chain directory from GET /v1/chains...
      Selected: Robinhood Chain (robinhood_mainnet, Chain ID 4663)
      Verifying eth_chainId via JSON-RPC...
      Verified Chain ID: 4663
      Calling eth_blockNumber via JSON-RPC...
      Latest Block: 77213136 (0x49a2dd0)

[5/5] Querying Data API GET /{chain}/status/freshness...
      Data Datasets Tracked: 15
      Dataset 'blocks': block 77213095 (0s lag)

=== Quickstart Completed Successfully ===
Key ID: k_xxxxxxxxxxxx (Revoke anytime via POST https://console-api.blockvectra.com/v1/keys/k_xxxxxxxxxxxx/revoke)
```

---

## Connecting Coding Assistants via MCP

BlockVectra exposes a Model Context Protocol (MCP) server over Streamable HTTP at:

```
https://docs.blockvectra.com/mcp
```

### 1. Claude Code Configuration

#### Keyless Documentation MCP
Provides read-only access to documentation, search, chain parameters, service status, and plan details without an API key:

```bash
claude mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp
```

#### Keyed MCP Tools
To enable tools that execute on-chain queries (`rpc_call`, `data_api_get`), pass the API key in the `-H` option:

```bash
claude mcp add --transport http -H "x-api-key: $BLOCKVECTRA_API_KEY" blockvectra-docs https://docs.blockvectra.com/mcp
```

### 2. Cursor Configuration

Add the server to `.cursor/mcp.json` or through Cursor Settings:

#### Keyless Documentation MCP
```json
{
  "mcpServers": {
    "blockvectra-docs": {
      "url": "https://docs.blockvectra.com/mcp"
    }
  }
}
```

#### Keyed MCP Tools
Configure the `headers` object so the API key is passed securely in HTTP headers:

```json
{
  "mcpServers": {
    "blockvectra": {
      "url": "https://docs.blockvectra.com/mcp",
      "headers": {
        "x-api-key": "${env:BLOCKVECTRA_API_KEY}"
      }
    }
  }
}
```

Cursor resolves environment variables with `${env:NAME}`. Make `BLOCKVECTRA_API_KEY` available to the Cursor process before starting it; this HTTP configuration does not read a project `.env` file. See [Cursor MCP configuration](https://cursor.com/docs/mcp#config-interpolation).

### MCP Security Requirements
- **Headers only**: API keys must be configured strictly in HTTP request headers (`x-api-key` or `Authorization: Bearer`).
- **Never pass keys in chat**: Do not pass API keys or wallet private keys as tool arguments or paste them into conversational prompts.
- **Cache bypass**: All keyed MCP requests carry `Cache-Control: no-store` to prevent caching of tenant data.

---

## Key Management and Account Recovery

If an agent loses its API key or session token, it can regain access using the same Ethereum wallet:

1. **Re-authenticate**: Submit a new SIWE challenge and signature to `POST /auth/siwe/login`. The server returns a fresh session token (`account_created: false`).
2. **List keys**:
   ```bash
   curl -s "https://console-api.blockvectra.com/v1/keys" \
     -H "Authorization: Bearer <session_token>"
   ```
3. **Revoke a key**:
   ```bash
   curl -s -X POST "https://console-api.blockvectra.com/v1/keys/<key_id>/revoke" \
     -H "Authorization: Bearer <session_token>"
   ```
4. **Provision a replacement key**:
   ```bash
   curl -s -X POST "https://console-api.blockvectra.com/v1/keys" \
     -H "Authorization: Bearer <session_token>" \
     -H "Content-Type: application/json" \
     -d '{"label":"agent-replacement-key"}'
   ```

---

## Related Documentation

- [Programmatic Sign-up Guide](https://docs.blockvectra.com/en/guides/programmatic-signup/?ref=gh-agent-quickstart)
- [AI Agent Integration Guide](https://docs.blockvectra.com/en/guides/ai-agents/?ref=gh-agent-quickstart)
- [Plans and Pricing](https://blockvectra.com/en/pricing/?ref=gh-agent-quickstart)
- [Data API OpenAPI Specification](https://docs.blockvectra.com/openapi/data.yaml?ref=gh-agent-quickstart)
- [JSON-RPC OpenAPI Specification](https://docs.blockvectra.com/openapi/json-rpc.yaml?ref=gh-agent-quickstart)

---

## License

[MIT](LICENSE)
