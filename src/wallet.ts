import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

type Account = ReturnType<typeof privateKeyToAccount>;

export type WalletIdentity = {
  account: Account;
  source: "environment" | "saved" | "created";
};

function accountFromKey(value: unknown, message: string): Account {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(message);
  }
  try {
    return privateKeyToAccount(value as Hex);
  } catch {
    // Do not expose key material through a dependency's validation error.
    throw new Error(message);
  }
}

function readSavedWallet(walletFile: string): Account | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(walletFile, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read the saved agent wallet. Restore access before retrying.");
  }

  const message = "Invalid saved agent wallet. Preserve the file and restore a trusted backup.";
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(message);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(message);
  }
  const wallet = data as Record<string, unknown>;
  const key = wallet.private_key !== undefined ? wallet.private_key : wallet.privateKey;
  const account = accountFromKey(key, message);
  if (wallet.private_key !== undefined && wallet.privateKey !== undefined) {
    const legacy = accountFromKey(wallet.privateKey, message);
    if (legacy.address !== account.address) throw new Error(message);
  }
  if (wallet.address !== undefined && (
    typeof wallet.address !== "string" || wallet.address.toLowerCase() !== account.address.toLowerCase()
  )) {
    throw new Error(message);
  }
  return account;
}

/** Resolve an identity before any API call; an existing file is never rewritten. */
export function loadOrCreateWallet(options: {
  walletFile: string;
  privateKey?: string;
}): WalletIdentity {
  if (options.privateKey !== undefined) {
    return {
      account: accountFromKey(options.privateKey, "Invalid AGENT_PRIVATE_KEY. Check the injected configuration."),
      source: "environment",
    };
  }

  const saved = readSavedWallet(options.walletFile);
  if (saved) return { account: saved, source: "saved" };

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  try {
    fs.writeFileSync(
      options.walletFile,
      JSON.stringify({ address: account.address, private_key: privateKey }, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const winner = readSavedWallet(options.walletFile);
      if (winner) return { account: winner, source: "saved" };
      throw new Error("The agent wallet changed during creation. Retry without deleting it.");
    }
    throw new Error("Cannot create the agent wallet. Check the wallet directory before retrying.");
  }
  return { account, source: "created" };
}
