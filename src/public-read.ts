import { ROBINHOOD_MAINNET_ID, selectRobinhoodMainnet } from "./chain-directory.js";
import { classifyQuantityResponse } from "./rpc-response.js";

const DIRECTORY_URL = "https://api.blockvectra.com/v1/chains";
const PUBLIC_RPC_URL = "https://api.blockvectra.com/v1/robinhood_mainnet/public";
const USER_AGENT = "BlockVectraAgentQuickstart/1";
const QA_USER_AGENT = "BlockVectraAgentQuickstart/1 BlockVectraQA/1";
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export interface PublicHead {
  chain: "robinhood_mainnet";
  chainId: number;
  blockNumber: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRobinhoodEntry(directory: unknown): Record<string, unknown> {
  if (!isRecord(directory) || !Array.isArray(directory.chains)) {
    throw new Error("Invalid chain directory");
  }
  const entry = directory.chains.find((candidate): candidate is Record<string, unknown> =>
    isRecord(candidate) && candidate.chain === "robinhood_mainnet");
  if (!entry) throw new Error("Robinhood mainnet entry is missing from the chain directory");
  return entry;
}

function validatePublicReadEntry(entry: Record<string, unknown>): void {
  if (entry.jsonrpc !== true) {
    throw new Error("Robinhood mainnet entry does not advertise JSON-RPC");
  }
  const publicEntry = entry.public;
  if (!isRecord(publicEntry)) {
    throw new Error("Robinhood mainnet public endpoint metadata is missing");
  }
  if (publicEntry.url !== PUBLIC_RPC_URL) {
    throw new Error("Robinhood mainnet public endpoint URL is not the expected keyless endpoint");
  }
  const methods = publicEntry.methods;
  if (!Array.isArray(methods) ||
    !methods.every((method): method is string => typeof method === "string") ||
    !methods.includes("eth_chainId") ||
    !methods.includes("eth_blockNumber")) {
    throw new Error("Robinhood mainnet public endpoint does not advertise the required methods");
  }
}

async function request(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  label: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal });
  } catch {
    throw new Error(`${label} request failed`);
  }
  if (response.redirected) throw new Error(`${label} response was redirected`);
  return response;
}

async function readJson(response: Response, signal: AbortSignal, label: string): Promise<unknown> {
  if (response.body === null || typeof response.body.getReader !== "function") {
    throw new Error(`${label} response body is unavailable`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal.aborted) throw new Error(`${label} response timed out`);

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw new Error(`${label} response body could not be read`);
      }

      if (signal.aborted) throw new Error(`${label} response timed out`);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        throw new Error(`${label} response body was not a byte stream`);
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The body is already unusable; the size failure is the error to report.
        }
        throw new Error(`${label} response exceeded 128 KiB`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} response was not valid UTF-8 JSON`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
}

async function readRpcQuantity(
  fetchImpl: typeof globalThis.fetch,
  userAgent: string,
  method: "eth_chainId" | "eth_blockNumber",
): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await request(fetchImpl, PUBLIC_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  }, signal, `Public RPC ${method}`);

  if (!response.ok) {
    throw new Error(`Public RPC ${method} failed (HTTP ${response.status})`);
  }

  const body = await readJson(response, signal, `Public RPC ${method}`);
  const classified = classifyQuantityResponse(response.ok, body);
  if (classified.kind !== "success") {
    throw new Error(`Public RPC ${method} returned an invalid or rejected response`);
  }
  return classified.quantity;
}

/**
 * Read the Robinhood mainnet head through the keyless public endpoint.
 * The directory is validated before any RPC request, and the two RPC calls
 * run serially with no retries.
 */
export async function readPublicHead(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  internalQa = false,
): Promise<PublicHead> {
  const userAgent = internalQa ? QA_USER_AGENT : USER_AGENT;
  const directorySignal = AbortSignal.timeout(TIMEOUT_MS);
  const directoryResponse = await request(fetchImpl, DIRECTORY_URL, {
    method: "GET",
    headers: { "User-Agent": userAgent },
  }, directorySignal, "Chain directory");

  if (!directoryResponse.ok) {
    throw new Error(`Chain directory request failed (HTTP ${directoryResponse.status})`);
  }
  const directory = await readJson(directoryResponse, directorySignal, "Chain directory");

  selectRobinhoodMainnet(directory);
  validatePublicReadEntry(findRobinhoodEntry(directory));

  const chainIdQuantity = await readRpcQuantity(fetchImpl, userAgent, "eth_chainId");
  let chainId: bigint;
  try {
    chainId = BigInt(chainIdQuantity);
  } catch {
    throw new Error("Public RPC eth_chainId was not a valid quantity");
  }
  if (chainId !== BigInt(ROBINHOOD_MAINNET_ID)) {
    throw new Error("Public RPC eth_chainId did not match Robinhood mainnet");
  }

  const blockQuantity = await readRpcQuantity(fetchImpl, userAgent, "eth_blockNumber");
  let blockNumber: string;
  try {
    blockNumber = BigInt(blockQuantity).toString(10);
  } catch {
    throw new Error("Public RPC eth_blockNumber was not a valid quantity");
  }

  return {
    chain: "robinhood_mainnet",
    chainId: ROBINHOOD_MAINNET_ID,
    blockNumber,
  };
}
