import { ROBINHOOD_MAINNET_ID, selectRobinhoodMainnet } from "./chain-directory.ts";

export const CHAIN_ID_USAGE = "Usage: node src/public-read-cli.ts [positive-decimal-chain-id]";

export function validateExpectedChainId(chainId: number): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid expected chain ID");
  }
}

/** No argument retains the original Robinhood mainnet example. */
export function parseChainIdArgs(args: readonly string[]): number {
  if (args.length === 0) return ROBINHOOD_MAINNET_ID;
  if (args.length !== 1 || !/^[1-9][0-9]*$/.test(args[0])) {
    throw new Error(CHAIN_ID_USAGE);
  }
  const chainId = Number(args[0]);
  if (!Number.isSafeInteger(chainId) || String(chainId) !== args[0]) throw new Error(CHAIN_ID_USAGE);
  return chainId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A chain ID selects metadata, never an arbitrary URL supplied by the caller. */
export function selectPublicReadChain(directory: unknown, expectedChainId: number) {
  validateExpectedChainId(expectedChainId);
  if (!isRecord(directory) || !Array.isArray(directory.chains)) {
    throw new Error("Invalid chain directory");
  }
  // Retain the existing exact slug + ID requirement for the default network.
  if (expectedChainId === ROBINHOOD_MAINNET_ID) selectRobinhoodMainnet(directory);
  const entries = directory.chains.filter(isRecord);
  const matches = entries.filter((entry) => entry.chain_id === expectedChainId);
  if (matches.length !== 1) throw new Error("Chain ID is missing or ambiguous in the directory");
  const entry = matches[0];
  if (typeof entry.chain !== "string" || entry.chain.trim() !== entry.chain || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(entry.chain) ||
    entries.filter((candidate) => candidate.chain === entry.chain).length !== 1) {
    throw new Error("Chain slug is invalid or ambiguous in the directory");
  }
  const rpcUrl = `https://api.blockvectra.com/v1/${entry.chain}/public`;
  const label = expectedChainId === ROBINHOOD_MAINNET_ID ? "Robinhood mainnet" : "Selected chain";
  if (entry.jsonrpc !== true) throw new Error(`${label} entry does not advertise JSON-RPC`);
  if (!isRecord(entry.public)) throw new Error(`${label} public endpoint metadata is missing`);
  if (entry.public.url !== rpcUrl) {
    throw new Error(`${label} public endpoint URL is not the expected keyless endpoint`);
  }
  const methods = entry.public.methods;
  if (!Array.isArray(methods) || !methods.every((method) => typeof method === "string") ||
    !methods.includes("eth_chainId") || !methods.includes("eth_blockNumber")) {
    throw new Error(`${label} public endpoint does not advertise the required methods`);
  }
  return { chain: entry.chain, chainId: expectedChainId, rpcUrl };
}
