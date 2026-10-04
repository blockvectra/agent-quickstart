import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const CONSOLE_API = "https://console-api.blockvectra.com/v1";
const GATEWAY_API = "https://api.blockvectra.com/v1";
const WALLET_FILE = path.resolve(".agent-wallet.json");

function mask(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("=== BlockVectra AI Agent Quickstart ===\n");

  // 1. Resolve or generate agent wallet
  let apiKey = process.env.BLOCKVECTRA_API_KEY?.trim();
  let key_id: string | undefined;

  if (apiKey) {
    console.log("[1-3/5] Found BLOCKVECTRA_API_KEY in environment, skipping wallet & key provisioning.\n");
    console.log(`      API Key: ${mask(apiKey)}`);
  } else {
    let privateKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;

    if (privateKey) {
      console.log("[1/5] Loaded agent wallet from AGENT_PRIVATE_KEY.\n");
    } else if (fs.existsSync(WALLET_FILE)) {
      try {
        const walletData = JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8"));
        const savedKey = (walletData.private_key || walletData.privateKey) as Hex | undefined;
        if (savedKey && typeof savedKey === "string" && savedKey.startsWith("0x")) {
          privateKey = savedKey;
          console.log("[1/5] Loaded agent wallet from .agent-wallet.json.\n");
        }
      } catch {
        // Fall through to generate new key if reading fails
      }
    }

    if (!privateKey) {
      privateKey = generatePrivateKey();
      const tempAccount = privateKeyToAccount(privateKey);
      fs.writeFileSync(
        WALLET_FILE,
        JSON.stringify({ address: tempAccount.address, private_key: privateKey }, null, 2) + "\n",
        { mode: 0o600 }
      );
      try {
        fs.chmodSync(WALLET_FILE, 0o600);
      } catch {
        // Best-effort chmod if filesystem does not support POSIX permissions
      }
      console.log("[1/5] Generated agent wallet and saved to .agent-wallet.json (0600).");
      console.log("      Tip: Set AGENT_PRIVATE_KEY in your environment to override.\n");
    }

    const account = privateKeyToAccount(privateKey);
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
  const chainsRes = await fetch(`${GATEWAY_API}/chains`);
  if (!chainsRes.ok) throw new Error(`Fetch chains failed: ${chainsRes.status}`);
  const { chains } = (await chainsRes.json()) as {
    chains: Array<{ chain: string; name: string; chain_id: number }>;
  };
  const rhChain = chains.find((c) => c.chain === "robinhood_mainnet" || c.name.includes("Robinhood"));
  if (!rhChain) throw new Error("Robinhood Chain not found in /v1/chains");
  console.log(`      Selected: ${rhChain.name} (${rhChain.chain}, Chain ID ${rhChain.chain_id})`);

  console.log("      Calling eth_blockNumber via JSON-RPC...");
  let blockNumberHex: string | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const rpcRes = await fetch(`${GATEWAY_API}/${rhChain.chain}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const rpcJson = (await rpcRes.json()) as {
      result?: string;
      error?: { code: number; message: string; data?: { retryable?: boolean } };
    };
    if (rpcJson.result) {
      blockNumberHex = rpcJson.result;
      break;
    }
    if (rpcJson.error?.data?.retryable && attempt < 5) {
      console.log(`      Waiting for key cache propagation (attempt ${attempt}/5)...`);
      await sleep(2000);
      continue;
    }
    throw new Error(`RPC call failed: ${JSON.stringify(rpcJson.error)}`);
  }
  console.log(`      Latest Block: ${parseInt(blockNumberHex!, 16)} (${blockNumberHex})`);

  // 5. Query Data API read-only endpoint
  console.log("\n[5/5] Querying Data API GET /{chain}/status/freshness...");
  const dataRes = await fetch(`${GATEWAY_API}/data/${rhChain.chain}/status/freshness`, {
    headers: { "x-api-key": apiKey },
  });
  if (!dataRes.ok) throw new Error(`Data API failed: ${dataRes.status} ${await dataRes.text()}`);
  const freshness = (await dataRes.json()) as {
    data: Array<{ dataset: string; max_block_number: number; seconds_behind: number }>;
  };
  console.log(`      Data Datasets Tracked: ${freshness.data.length}`);
  const blockDataset = freshness.data.find((d) => d.dataset === "blocks");
  if (blockDataset) {
    console.log(`      Dataset 'blocks': block ${blockDataset.max_block_number} (${blockDataset.seconds_behind}s lag)`);
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
