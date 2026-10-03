# BlockVectra AI Agent Quickstart (TypeScript)

A minimal, end-to-end TypeScript example demonstrating how an autonomous AI agent or automated script can onboard and interact with BlockVectra without a browser or human intervention.

This example covers:
1. **Wallet identity**: Reads an Ethereum EOA private key from `AGENT_PRIVATE_KEY` or from a local `.agent-wallet.json` file. If neither is configured, generates a new wallet locally and saves it to `.agent-wallet.json` (permission `0600`) so subsequent runs reuse the same identity instead of creating new accounts.
2. **Programmatic account sign-up**: Authenticates via Sign-In with Ethereum (SIWE / EIP-191) against `https://console-api.blockvectra.com/v1` in programmatic mode (omitting the `Origin` header). First-time wallet sign-in automatically provisions an account.
3. **API key provisioning**: Creates an API key (`rgw_...`) using the authenticated session token (`rgs_...`).
4. **JSON-RPC execution**: Reads the active chain directory from `GET https://api.blockvectra.com/v1/chains` and executes `eth_blockNumber` on Robinhood Chain (`robinhood_mainnet`) using the API key.
5. **Data API query**: Calls the read-only dataset freshness endpoint (`GET /v1/data/{chain}/status/freshness`) defined in the OpenAPI specification.

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
- npm or another Node.js package manager

---

## Installation & Setup

1. Clone or navigate to the directory:

   ```bash
   cd agent-quickstart
   ```

2. Install dependencies (only `viem` and `tsx`):

   ```bash
   npm install
   ```

3. (Optional) Configure an existing wallet:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` to supply `AGENT_PRIVATE_KEY=0x...`. If omitted, the script checks for an existing `.agent-wallet.json`. If not found, a new wallet is generated and saved to `.agent-wallet.json` (permission `0600`) for reuse across runs. The private key is never printed to the console.

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

---

## Example Output

Below is actual execution output from a live test run:

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
      API Key: rgw_9b70...

[4/5] Reading chain directory from GET /v1/chains...
      Selected: Robinhood Chain (robinhood_mainnet, Chain ID 4663)
      Calling eth_blockNumber via JSON-RPC...
      Latest Block: 77213136 (0x49a2dd0)

[5/5] Querying Data API GET /{chain}/status/freshness...
      Data Datasets Tracked: 15
      Dataset 'blocks': block 77213095 (0s lag)

=== Quickstart Completed Successfully ===
Created Key ID: k_xxxxxxxxxxxx (Revoke anytime via POST https://console-api.blockvectra.com/v1/keys/k_xxxxxxxxxxxx/revoke)
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
        "x-api-key": "${BLOCKVECTRA_API_KEY}"
      }
    }
  }
}
```

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

- [Programmatic Sign-up Guide](https://docs.blockvectra.com/en/guides/programmatic-signup/)
- [AI Agent Integration Guide](https://docs.blockvectra.com/en/guides/ai-agents/)
- [Plans and Pricing](https://blockvectra.com/en/pricing/)
- [Data API OpenAPI Specification](https://docs.blockvectra.com/openapi/data.yaml)
- [JSON-RPC OpenAPI Specification](https://docs.blockvectra.com/openapi/json-rpc.yaml)

---

## License

[MIT](LICENSE)
