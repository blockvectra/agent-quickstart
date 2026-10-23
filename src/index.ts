import path from "node:path";
import { loadOrCreateWallet } from "./wallet.js";
import { classifyQuantityResponse } from "./rpc-response.js";
import { ROBINHOOD_MAINNET_ID, selectRobinhoodMainnet } from "./chain-directory.js";
import { readFreshness } from "./data-freshness.js";

const CONSOLE_API = "https://console-api.blockvectra.com/v1";
const API_BASE = "https://api.blockvectra.com/v1";
const WALLET_FILE = path.resolve(".agent-wallet.json");

function mask(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readRpcQuantity(chain: string, apiKey: string, method: "eth_chainId" | "eth_blockNumber") {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const rpcRes = await fetch(`${API_BASE}/${chain}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    });
    let rpcJson: unknown;
    try {
      rpcJson = await rpcRes.json();
    } catch {
      throw new Error(`RPC response was not valid JSON (HTTP ${rpcRes.status})`);
    }
    const response = classifyQuantityResponse(rpcRes.ok, rpcJson);
    if (response.kind === "success") return response.quantity;
    if (response.kind === "retryable-error" && attempt < 5) {
      console.log(`      Retrying ${method} verification (attempt ${attempt}/5)...`);
      await sleep(2000);
      continue;
    }
    throw new Error(`RPC verification failed for ${method} (HTTP ${rpcRes.status}): invalid response or rejected call`);
  }
  throw new Error(`RPC verification failed for ${method}`);
}

async function main() {
  console.log("=== BlockVectra AI Agent Quickstart ===\n");

  // 1. Resolve or generate agent wallet
  let apiKey = process.env.BLOCKVECTRA_API_KEY?.trim();
  let key_id: string | undefined;

  if (apiKey) {
    console.log("[1-3/5] Found BLOCKVECTRA_API_KEY in environment, skipping wallet & key provisioning.\n");
    console.log(`      API Key: ${mask(apiKey)}`);
  } else {
    const { account, source } = loadOrCreateWallet({
      walletFile: WALLET_FILE,
      privateKey: process.env.AGENT_PRIVATE_KEY,
    });

    if (source === "environment") {
      console.log("[1/5] Loaded agent wallet from AGENT_PRIVATE_KEY.\n");
    } else if (source === "saved") {
      console.log("[1/5] Loaded agent wallet from .agent-wallet.json.\n");
    } else {
      console.log("[1/5] Generated agent wallet and saved to .agent-wallet.json (0600).");
      console.log("      Tip: Set AGENT_PRIVATE_KEY in your environment to override.\n");
    }

    console.log(`      Wallet Address: ${account.address}`);

    // 2. Programmatic SIWE sign-in / signup (omit Origin header)
    console.log("\n[2/5] Requesting SIWE challenge...");
    const chalRes = await fetch(`${CONSOLE_API}/auth/siwe/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account.address, purpose: "login" }),
    });
    if (!chalRes.ok) throw new Error(`Challenge request failed: ${chalRes.status} ${await chalRes.text()}`);
    const { message } = (await chalRes.json()) as { message: string };

    console.log("      Signing verbatim challenge message with EIP-191...");
    const signature = await account.signMessage({ message });

    console.log("      Submitting SIWE login...");
    const loginRes = await fetch(`${CONSOLE_API}/auth/siwe/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `ref` is an optional sign-up attribution field (saved only when a new account is created).
      body: JSON.stringify({ message, signature, ref: "gh-agent-quickstart" }),
    });
    if (!loginRes.ok) throw new Error(`Login request failed: ${loginRes.status} ${await loginRes.text()}`);
    const loginData = (await loginRes.json()) as {
      session: { token: string };
      account_created: boolean;
    };
    const sessionToken = loginData.session.token;
    console.log(`      Account Created: ${loginData.account_created}`);
    console.log(`      Session Token: ${mask(sessionToken)}`);

    // 3. Create an API key
    console.log("\n[3/5] Provisioning API key...");
    const keyRes = await fetch(`${CONSOLE_API}/keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "agent-quickstart" }),
    });
    if (!keyRes.ok) throw new Error(`Create key failed: ${keyRes.status} ${await keyRes.text()}`);
    const keyData = (await keyRes.json()) as {
      key: { key_id: string; label: string; status: string };
      api_key: string;
    };
    key_id = keyData.key.key_id;
    apiKey = keyData.api_key;
    console.log(`      Key ID: ${key_id}`);
    console.log(`      API Key: ${mask(apiKey)}`);
  }

  // 4. Fetch chain list & call JSON-RPC
  console.log("\n[4/5] Reading chain directory from GET /v1/chains...");
  const chainsRes = await fetch(`${API_BASE}/chains`);
  if (!chainsRes.ok) throw new Error(`Fetch chains failed: ${chainsRes.status}`);
  const rhChain = selectRobinhoodMainnet(await chainsRes.json());
  console.log(`      Selected: ${rhChain.name} (${rhChain.chain}, Chain ID ${rhChain.chain_id})`);

  console.log("      Verifying eth_chainId via JSON-RPC...");
  const chainIdHex = await readRpcQuantity(rhChain.chain, apiKey, "eth_chainId");
  if (BigInt(chainIdHex) !== BigInt(ROBINHOOD_MAINNET_ID)) {
    throw new Error("RPC chain ID does not match Robinhood mainnet (4663)");
  }
  console.log(`      Verified Chain ID: ${ROBINHOOD_MAINNET_ID}`);
  console.log("      Calling eth_blockNumber via JSON-RPC...");
  const blockNumberHex = await readRpcQuantity(rhChain.chain, apiKey, "eth_blockNumber");
  console.log(`      Latest Block: ${BigInt(blockNumberHex).toString(10)} (${blockNumberHex})`);

  // 5. Query Data API read-only endpoint
  console.log("\n[5/5] Querying Data API GET /{chain}/status/freshness...");
  const dataRes = await fetch(`${API_BASE}/data/${rhChain.chain}/status/freshness`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  const freshness = await readFreshness(dataRes, rhChain.chain);
  console.log(`      Data Datasets Tracked: ${freshness.length}`);
  const blockDataset = freshness.find((d) => d.dataset === "blocks");
  if (blockDataset) {
    const block = blockDataset.max_block_number === null ? "unknown" : blockDataset.max_block_number.toString(10);
    const lag = blockDataset.seconds_behind === null ? "unknown" : `${blockDataset.seconds_behind}s`;
    console.log(`      Dataset 'blocks': block ${block} (${lag} lag)`);
  }

  console.log("\n=== Quickstart Completed Successfully ===");
  if (key_id) {
    console.log(`Created Key ID: ${key_id} (Revoke anytime via POST https://console-api.blockvectra.com/v1/keys/${key_id}/revoke)\n`);
  }
}

main().catch((err) => {
  console.error("Agent execution error:", err);
  process.exit(1);
});
