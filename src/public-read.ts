import { ROBINHOOD_MAINNET_ID } from "./chain-directory.ts";
import { selectPublicReadChain, validateExpectedChainId } from "./public-read-chain.ts";
import { classifyQuantityResponse } from "./rpc-response.ts";

const DIRECTORY_URL = "https://api.blockvectra.com/v1/chains";
const USER_AGENT = "BlockVectraAgentQuickstart/1";
const QA_USER_AGENT = "BlockVectraAgentQuickstart/1 BlockVectraQA/1";
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export interface PublicHead {
  chain: string;
  chainId: number;
  blockNumber: string;
}

function discardResponseBody(response: Response): void {
  const body = response.body;
  if (body === null || typeof body.cancel !== "function") return;
  try {
    void body.cancel().catch(() => {});
  } catch {
    // Cleanup is best effort and must not replace the first business error.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // Cleanup is best effort and must not replace the first business error.
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // Cleanup is best effort and must not replace the first business error.
  }
}

async function request(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  label: string,
): Promise<Response> {
  const fetchPromise = Promise.resolve().then(() => fetchImpl(url, { ...init, redirect: "error", signal }));

  const response = await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // A fetch mock can resolve after the deadline even though it ignored the signal.
      void fetchPromise.then((lateResponse) => discardResponseBody(lateResponse), () => {});
      reject(new Error(`${label} request timed out`));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    fetchPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`${label} request failed`));
      },
    );
  });

  if (response.redirected) {
    discardResponseBody(response);
    throw new Error(`${label} response was redirected`);
  }
  return response;
}

function readWithDeadline(
  readPromise: Promise<ReadableStreamReadResult<Uint8Array>>,
  signal: AbortSignal,
  label: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${label} response timed out`));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    readPromise.then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`${label} response body could not be read`));
      },
    );
  });
}

async function readJson(response: Response, signal: AbortSignal, label: string): Promise<unknown> {
  if (response.body === null || typeof response.body.getReader !== "function") {
    discardResponseBody(response);
    throw new Error(`${label} response body is unavailable`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;

  try {
    while (true) {
      if (signal.aborted) throw new Error(`${label} response timed out`);

      try {
        pendingRead = reader.read();
      } catch {
        throw new Error(`${label} response body could not be read`);
      }

      const result = await readWithDeadline(pendingRead, signal, label);
      pendingRead = undefined;

      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        throw new Error(`${label} response body was not a byte stream`);
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new Error(`${label} response exceeded 128 KiB`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    // cancel() may itself hang. Start it without awaiting it, then let the
    // reader's pending read settle before releasing the lock.
    cancelReader(reader);
    if (pendingRead !== undefined) {
      try {
        await pendingRead;
      } catch {
        // Cleanup must not replace the first business error.
      }
    }
    throw error;
  } finally {
    releaseReader(reader);
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
  rpcUrl: string,
  method: "eth_chainId" | "eth_blockNumber",
): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await request(fetchImpl, rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  }, signal, `Public RPC ${method}`);

  if (!response.ok) {
    discardResponseBody(response);
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
 * Read the selected chain head through its advertised keyless public endpoint.
 * The directory is validated before any RPC request, and the two RPC calls
 * run serially with no retries.
 */
export async function readPublicHead(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  internalQa = false,
  expectedChainId = ROBINHOOD_MAINNET_ID,
): Promise<PublicHead> {
  validateExpectedChainId(expectedChainId);
  const userAgent = internalQa ? QA_USER_AGENT : USER_AGENT;
  const directorySignal = AbortSignal.timeout(TIMEOUT_MS);
  const directoryResponse = await request(fetchImpl, DIRECTORY_URL, {
    method: "GET",
    headers: { "User-Agent": userAgent },
  }, directorySignal, "Chain directory");

  if (!directoryResponse.ok) {
    discardResponseBody(directoryResponse);
    throw new Error(`Chain directory request failed (HTTP ${directoryResponse.status})`);
  }
  const directory = await readJson(directoryResponse, directorySignal, "Chain directory");

  const selected = selectPublicReadChain(directory, expectedChainId);

  const chainIdQuantity = await readRpcQuantity(fetchImpl, userAgent, selected.rpcUrl, "eth_chainId");
  let chainId: bigint;
  try {
    chainId = BigInt(chainIdQuantity);
  } catch {
    throw new Error("Public RPC eth_chainId was not a valid quantity");
  }
  if (chainId !== BigInt(expectedChainId)) {
    throw new Error(expectedChainId === ROBINHOOD_MAINNET_ID
      ? "Public RPC eth_chainId did not match Robinhood mainnet"
      : "Public RPC eth_chainId did not match the requested chain ID");
  }

  const blockQuantity = await readRpcQuantity(fetchImpl, userAgent, selected.rpcUrl, "eth_blockNumber");
  let blockNumber: string;
  try {
    blockNumber = BigInt(blockQuantity).toString(10);
  } catch {
    throw new Error("Public RPC eth_blockNumber was not a valid quantity");
  }

  return {
    chain: selected.chain,
    chainId: expectedChainId,
    blockNumber,
  };
}
