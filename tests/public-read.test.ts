import assert from "node:assert/strict";
import { test } from "node:test";

const DIRECTORY_URL = "https://api.blockvectra.com/v1/chains";
const PUBLIC_RPC_URL = "https://api.blockvectra.com/v1/robinhood_mainnet/public";
const SECRET = "synthetic-secret-value-do-not-echo";

const realFetch = globalThis.fetch;
let fetchesDuringImport = 0;
globalThis.fetch = (() => {
  fetchesDuringImport += 1;
  throw new Error("network is disabled during module import");
}) as typeof fetch;
const { readPublicHead } = await import("../src/public-read.js");
globalThis.fetch = realFetch;

const baseEntry = () => ({
  chain: "robinhood_mainnet",
  chain_id: 4663,
  name: "Robinhood Chain",
  jsonrpc: true,
  public: {
    url: PUBLIC_RPC_URL,
    methods: ["eth_chainId", "eth_blockNumber"],
  },
  methods: { allow: ["eth_blockNumber"] },
});

const directoryWith = (entry: unknown = baseEntry()) => ({ chains: [entry] });

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const rpcResult = (result: string, id: unknown = 1) => ({ jsonrpc: "2.0", id, result });

interface ScriptedCall {
  url: string;
  init: RequestInit;
}

type Step = Response | ((call: ScriptedCall) => Response | Promise<Response>);

function scriptedFetch(steps: Step[]) {
  const calls: ScriptedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unexpected request ${calls.length}: ${call.url}`);
    return typeof step === "function" ? await step(call) : step;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function headerNames(call: ScriptedCall): string[] {
  return [...new Headers(call.init.headers).keys()].sort();
}

function sequence(chainId = "0x1237", blockNumber = "0x10", directory: unknown = directoryWith()) {
  return scriptedFetch([
    response(directory),
    response(rpcResult(chainId)),
    response(rpcResult(blockNumber)),
  ]);
}

function assertNoCredentialHeaders(calls: ScriptedCall[]): void {
  for (const call of calls) {
    const names = headerNames(call);
    for (const forbidden of ["authorization", "x-api-key", "cookie", "proxy-authorization"]) {
      assert.equal(names.includes(forbidden), false, `unexpected ${forbidden} header`);
    }
  }
}

function assertRpcCall(call: ScriptedCall, method: "eth_chainId" | "eth_blockNumber"): void {
  assert.equal(call.url, PUBLIC_RPC_URL);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: [],
  });
  assert.deepEqual(headerNames(call), ["content-type", "user-agent"]);
  assert.equal(new Headers(call.init.headers).get("content-type"), "application/json");
  assert.equal(call.init.redirect, "error");
  assert.ok(call.init.signal);
}

test("importing the public-read module performs no requests", () => {
  assert.equal(fetchesDuringImport, 0);
});

for (const [label, blockQuantity, expected] of [
  ["zero height", "0x0", "0"],
  ["height above MAX_SAFE_INTEGER", "0x20000000000000", "9007199254740992"],
] as const) {
  test(`reads the public head exactly once per phase with ${label}`, async () => {
    const previousApiKey = process.env.BLOCKVECTRA_API_KEY;
    const previousPrivateKey = process.env.AGENT_PRIVATE_KEY;
    process.env.BLOCKVECTRA_API_KEY = SECRET;
    process.env.AGENT_PRIVATE_KEY = SECRET;

    try {
      const { fetchImpl, calls } = sequence("0x1237", blockQuantity);
      const result = await readPublicHead(fetchImpl);

      assert.deepEqual(result, {
        chain: "robinhood_mainnet",
        chainId: 4663,
        blockNumber: expected,
      });
      assert.equal(calls.length, 3);
      assert.equal(calls[0].url, DIRECTORY_URL);
      assert.equal(calls[0].init.method, "GET");
      assert.equal(calls[0].init.redirect, "error");
      assert.ok(calls[0].init.signal);
      assert.deepEqual(headerNames(calls[0]), ["user-agent"]);
      assertRpcCall(calls[1], "eth_chainId");
      assertRpcCall(calls[2], "eth_blockNumber");
      assertNoCredentialHeaders(calls);

      const transcript = JSON.stringify({ result, calls });
      assert.equal(transcript.includes(SECRET), false);
    } finally {
      if (previousApiKey === undefined) delete process.env.BLOCKVECTRA_API_KEY;
      else process.env.BLOCKVECTRA_API_KEY = previousApiKey;
      if (previousPrivateKey === undefined) delete process.env.AGENT_PRIVATE_KEY;
      else process.env.AGENT_PRIVATE_KEY = previousPrivateKey;
    }
  });
}

test("a wrong chain ID stops before eth_blockNumber without retrying", async () => {
  const { fetchImpl, calls } = sequence("0x1", "0x10");
  await assert.rejects(readPublicHead(fetchImpl), /did not match Robinhood mainnet/);
  assert.equal(calls.length, 2);
  assertRpcCall(calls[1], "eth_chainId");
});

test("the user-agent QA suffix is enabled only by the explicit flag", async () => {
  const normal = sequence();
  await readPublicHead(normal.fetchImpl);
  for (const call of normal.calls) {
    assert.equal(new Headers(call.init.headers).get("user-agent"), "BlockVectraAgentQuickstart/1");
  }

  const qa = sequence();
  await readPublicHead(qa.fetchImpl, true);
  for (const call of qa.calls) {
    assert.equal(
      new Headers(call.init.headers).get("user-agent"),
      "BlockVectraAgentQuickstart/1 BlockVectraQA/1",
    );
  }
});

const directoryRejections: Array<[string, unknown]> = [
  ["a non-object directory", []],
  ["a missing Robinhood entry", directoryWith({ chain: "ethereum_mainnet", chain_id: 1 })],
  [
    "duplicate Robinhood IDs",
    { chains: [baseEntry(), baseEntry()] },
  ],
  [
    "jsonrpc disabled",
    directoryWith({ ...baseEntry(), jsonrpc: false }),
  ],
  [
    "public metadata missing",
    (() => {
      const entry = baseEntry() as Record<string, unknown>;
      delete entry.public;
      return directoryWith(entry);
    })(),
  ],
  [
    "public metadata not an object",
    directoryWith({ ...baseEntry(), public: PUBLIC_RPC_URL }),
  ],
  [
    "an arbitrary public URL",
    directoryWith({
      ...baseEntry(),
      public: { url: "https://example.invalid/v1/robinhood_mainnet/public", methods: ["eth_chainId", "eth_blockNumber"] },
    }),
  ],
  [
    "a trailing-slash public URL",
    directoryWith({
      ...baseEntry(),
      public: { url: `${PUBLIC_RPC_URL}/`, methods: ["eth_chainId", "eth_blockNumber"] },
    }),
  ],
  [
    "public methods not an array",
    directoryWith({
      ...baseEntry(),
      public: { url: PUBLIC_RPC_URL, methods: "eth_chainId,eth_blockNumber" },
    }),
  ],
  [
    "a non-string public method",
    directoryWith({
      ...baseEntry(),
      public: { url: PUBLIC_RPC_URL, methods: ["eth_chainId", "eth_blockNumber", 1] },
    }),
  ],
  [
    "eth_chainId missing from public methods",
    directoryWith({
      ...baseEntry(),
      public: { url: PUBLIC_RPC_URL, methods: ["eth_blockNumber"] },
    }),
  ],
  [
    "eth_blockNumber missing from public methods",
    directoryWith({
      ...baseEntry(),
      public: { url: PUBLIC_RPC_URL, methods: ["eth_chainId"] },
    }),
  ],
  [
    "only the full-chain allow-list advertises the method",
    directoryWith({
      ...baseEntry(),
      public: { url: PUBLIC_RPC_URL, methods: ["eth_chainId"] },
      methods: { allow: ["eth_chainId", "eth_blockNumber"] },
    }),
  ],
];

for (const [label, directory] of directoryRejections) {
  test(`directory validation rejects ${label} before any RPC`, async () => {
    const { fetchImpl, calls } = scriptedFetch([response(directory)]);
    await assert.rejects(readPublicHead(fetchImpl));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DIRECTORY_URL);
  });
}

test("a directory response without a body is rejected", async () => {
  const { fetchImpl, calls } = scriptedFetch([new Response(null, { status: 200 })]);
  await assert.rejects(readPublicHead(fetchImpl), /body is unavailable/);
  assert.equal(calls.length, 1);
});

test("a response body without a reader is rejected", async () => {
  const fakeResponse = {
    ok: true,
    status: 200,
    redirected: false,
    body: {},
  } as unknown as Response;
  const { fetchImpl, calls } = scriptedFetch([fakeResponse]);
  await assert.rejects(readPublicHead(fetchImpl), /body is unavailable/);
  assert.equal(calls.length, 1);
});

test("invalid JSON and array envelopes are rejected without RPC", async () => {
  const invalidJson = scriptedFetch([response(`{"chains":["${SECRET}"`)]);
  await assert.rejects(readPublicHead(invalidJson.fetchImpl), (error: Error) => {
    assert.match(error.message, /not valid JSON/);
    assert.equal(error.message.includes(SECRET), false);
    return true;
  });
  assert.equal(invalidJson.calls.length, 1);

  const arrayEnvelope = scriptedFetch([response([{ chain: "robinhood_mainnet" }])]);
  await assert.rejects(readPublicHead(arrayEnvelope.fetchImpl));
  assert.equal(arrayEnvelope.calls.length, 1);
});

test("HTTP errors stop each phase at its own boundary", async () => {
  const directoryError = scriptedFetch([response("upstream detail", 503)]);
  await assert.rejects(readPublicHead(directoryError.fetchImpl), /HTTP 503/);
  assert.equal(directoryError.calls.length, 1);

  const chainIdError = scriptedFetch([
    response(directoryWith()),
    response("upstream detail", 500),
  ]);
  await assert.rejects(readPublicHead(chainIdError.fetchImpl), /HTTP 500/);
  assert.equal(chainIdError.calls.length, 2);

  const blockError = scriptedFetch([
    response(directoryWith()),
    response(rpcResult("0x1237")),
    response("upstream detail", 502),
  ]);
  await assert.rejects(readPublicHead(blockError.fetchImpl), /HTTP 502/);
  assert.equal(blockError.calls.length, 3);
});

test("a redirect response stops without following it", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    response(directoryWith(), 302, { location: "https://example.invalid/chains" }),
  ]);
  await assert.rejects(readPublicHead(fetchImpl), /HTTP 302/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "error");
});

const badChainIdResponses: Array<[string, unknown]> = [
  ["error with a result", { jsonrpc: "2.0", id: 1, result: "0x1237", error: { code: -1, message: "bad", data: { retryable: true } } }],
  ["a wrong response ID", rpcResult("0x1237", 2)],
  ["a non-hex quantity", rpcResult("4663")],
  ["a leading-zero quantity", rpcResult("0x00")],
  ["a numeric result", { jsonrpc: "2.0", id: 1, result: 4663 }],
  ["a non-object envelope", []],
  ["a null envelope", null],
];

for (const [label, body] of badChainIdResponses) {
  test(`chain-ID validation rejects ${label} without a block-number call`, async () => {
    const { fetchImpl, calls } = scriptedFetch([
      response(directoryWith()),
      response(body),
    ]);
    await assert.rejects(readPublicHead(fetchImpl));
    assert.equal(calls.length, 2);
  });
}

test("invalid JSON and an invalid quantity stop the block-number phase", async () => {
  const invalidBlockJson = scriptedFetch([
    response(directoryWith()),
    response(rpcResult("0x1237")),
    response("not-json"),
  ]);
  await assert.rejects(readPublicHead(invalidBlockJson.fetchImpl), /not valid JSON/);
  assert.equal(invalidBlockJson.calls.length, 3);

  const invalidBlockQuantity = scriptedFetch([
    response(directoryWith()),
    response(rpcResult("0x1237")),
    response(rpcResult("0x")),
  ]);
  await assert.rejects(readPublicHead(invalidBlockQuantity.fetchImpl), /invalid or rejected/);
  assert.equal(invalidBlockQuantity.calls.length, 3);
});

test("retryable RPC errors stop after one attempt per phase", async () => {
  const retryable = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "busy", data: { retryable: true } },
  };
  const chainIdRetryable = scriptedFetch([response(directoryWith()), response(retryable)]);
  await assert.rejects(readPublicHead(chainIdRetryable.fetchImpl), /invalid or rejected/);
  assert.equal(chainIdRetryable.calls.length, 2);

  const blockRetryable = scriptedFetch([
    response(directoryWith()),
    response(rpcResult("0x1237")),
    response({ ...retryable, id: null }),
  ]);
  await assert.rejects(readPublicHead(blockRetryable.fetchImpl), /invalid or rejected/);
  assert.equal(blockRetryable.calls.length, 3);
});

test("a chunked body over 128 KiB is cancelled using actual bytes, not Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = new Uint8Array(64 * 1024);
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const oversized = new Response(body, {
    status: 200,
    headers: { "content-length": "1" },
  });
  const { fetchImpl, calls } = scriptedFetch([
    response(directoryWith()),
    oversized,
  ]);

  await assert.rejects(readPublicHead(fetchImpl), /exceeded 128 KiB/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  assert.equal(calls.length, 2);
});

test("a body exactly at 128 KiB is accepted when it contains valid JSON", async () => {
  const prefix = JSON.stringify(rpcResult("0x1237"));
  const padding = " ".repeat(128 * 1024 - prefix.length);
  const body = prefix + padding;
  assert.equal(new TextEncoder().encode(body).byteLength, 128 * 1024);

  const { fetchImpl } = scriptedFetch([
    response(directoryWith()),
    response(body),
    response(rpcResult("0x2a")),
  ]);
  const result = await readPublicHead(fetchImpl);
  assert.equal(result.blockNumber, "42");
});

async function withShortRequestTimeout<T>(run: () => Promise<T>): Promise<T> {
  const original = AbortSignal.timeout;
  (AbortSignal as unknown as { timeout: typeof AbortSignal.timeout }).timeout =
    ((milliseconds: number) => original(Math.min(milliseconds, 20))) as typeof AbortSignal.timeout;
  try {
    return await run();
  } finally {
    (AbortSignal as unknown as { timeout: typeof AbortSignal.timeout }).timeout = original;
  }
}

async function expectBoundedRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(
      Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("operation is still pending")), 500);
        }),
      ]),
      pattern,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

test("a pending fetch is bounded by the request deadline", async () => {
  let calls = 0;
  const fetchImpl = (() => {
    calls += 1;
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  await withShortRequestTimeout(async () => {
    await expectBoundedRejection(readPublicHead(fetchImpl), /request timed out/);
  });
  assert.equal(calls, 1);
});

test("a pending body read times out, cancels, and releases the reader", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start() {},
    cancel() {
      cancelled += 1;
      return new Promise<void>(() => {});
    },
  });
  const { fetchImpl, calls } = scriptedFetch([new Response(body, { status: 200 })]);

  await withShortRequestTimeout(async () => {
    await expectBoundedRejection(readPublicHead(fetchImpl), /response timed out/);
  });
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(calls.length, 1);
});

test("a pending cancel after an oversize body cannot block rejection or release", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(128 * 1024 + 1));
    },
    cancel() {
      cancelled += 1;
      return new Promise<void>(() => {});
    },
  });
  const { fetchImpl, calls } = scriptedFetch([new Response(body, { status: 200 })]);

  await expectBoundedRejection(readPublicHead(fetchImpl), /exceeded 128 KiB/);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(calls.length, 1);
});

test("non-2xx responses cancel their bodies at every phase without extra requests", async () => {
  const tracked = (status: number) => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => {});
      },
    });
    return {
      response: new Response(body, { status }),
      body,
      cancelled: () => cancelled,
    };
  };

  const directory = tracked(503);
  const directoryFetch = scriptedFetch([directory.response]);
  await assert.rejects(readPublicHead(directoryFetch.fetchImpl), /HTTP 503/);
  assert.equal(directory.cancelled(), 1);
  assert.equal(directory.body.locked, false);
  assert.equal(directoryFetch.calls.length, 1);

  const chainId = tracked(500);
  const chainIdFetch = scriptedFetch([response(directoryWith()), chainId.response]);
  await assert.rejects(readPublicHead(chainIdFetch.fetchImpl), /HTTP 500/);
  assert.equal(chainId.cancelled(), 1);
  assert.equal(chainId.body.locked, false);
  assert.equal(chainIdFetch.calls.length, 2);

  const blockNumber = tracked(502);
  const blockFetch = scriptedFetch([
    response(directoryWith()),
    response(rpcResult("0x1237")),
    blockNumber.response,
  ]);
  await assert.rejects(readPublicHead(blockFetch.fetchImpl), /HTTP 502/);
  assert.equal(blockNumber.cancelled(), 1);
  assert.equal(blockNumber.body.locked, false);
  assert.equal(blockFetch.calls.length, 3);
});

test("a redirected response is cancelled without following it or making extra requests", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start() {},
    cancel() {
      cancelled += 1;
      return new Promise<void>(() => {});
    },
  });
  const redirected = new Response(body, { status: 200 });
  Object.defineProperty(redirected, "redirected", { value: true });
  const { fetchImpl, calls } = scriptedFetch([redirected]);

  await assert.rejects(readPublicHead(fetchImpl), /redirected/);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(calls.length, 1);
});
