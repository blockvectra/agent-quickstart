import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { classifyQuantityResponse } from "../src/rpc-response.js";

const success = { jsonrpc: "2.0", id: 1, result: "0x10" };
const retry = {
  jsonrpc: "2.0", id: 1,
  error: { code: -32021, message: "synthetic retryable error", data: { retryable: true } },
};
const admissionRetry = {
  jsonrpc: "2.0", id: null,
  error: { code: -32021, message: "authentication data temporarily unavailable",
    data: { reason: "auth_unavailable", retryable: true } },
};

type Reply = { status: number; body?: unknown; invalidJson?: boolean };

function runEntry(t: TestContext, replies: Reply[], options: { directory?: unknown; chainReplies?: Reply[] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpc-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const trace = path.join(directory, "trace.json");
  const entry = new URL("../src/index.ts", import.meta.url).href;
  const loader = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
  const env = { ...process.env, BLOCKVECTRA_API_KEY: "offline-test-key-not-a-real-credential" };
  delete (env as Record<string, string | undefined>).AGENT_PRIVATE_KEY;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", `
    import fs from 'node:fs';
    const replies = ${JSON.stringify(replies)};
    const chainReplies = ${JSON.stringify(options.chainReplies ?? [{ status: 200, body: { ...success, result: "0x1237" } }])};
    const trace = { chain: 0, rpc: 0, data: 0, delays: 0, unexpected: 0 };
    process.on('exit', () => fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify(trace)));
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => {
      if (ms === 2000) { trace.delays++; return originalTimeout(fn, 0, ...args); }
      return originalTimeout(fn, ms, ...args);
    };
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/chains')) return Response.json(${JSON.stringify(options.directory === undefined ? { chains: [{ chain: 'robinhood_mainnet', name: 'Robinhood Chain', chain_id: 4663 }] } : options.directory)});
      if (String(url).endsWith('/robinhood_mainnet')) {
        const request = JSON.parse(options.body);
        if (request.jsonrpc !== '2.0' || request.id !== 1 || !['eth_chainId', 'eth_blockNumber'].includes(request.method) ||
          !Array.isArray(request.params) || request.params.length !== 0) throw Error('UNEXPECTED_RPC_REQUEST');
        const reply = request.method === 'eth_chainId'
          ? chainReplies[Math.min(trace.chain++, chainReplies.length - 1)]
          : replies[Math.min(trace.rpc++, replies.length - 1)];
        return reply.invalidJson
          ? new Response('{not-json', { status: reply.status })
          : Response.json(reply.body, { status: reply.status });
      }
      if (String(url).endsWith('/data/robinhood_mainnet/status/freshness')) {
        trace.data++;
        return Response.json({ data: [], meta: { chain: 'robinhood_mainnet' } });
      }
      trace.unexpected++;
      throw Error('UNEXPECTED_OFFLINE_ROUTE');
    };
    await import(${JSON.stringify(entry)});
  `], { cwd: directory, env, encoding: "utf-8", timeout: 10_000 });
  assert.ok(!child.error, "offline entrypoint must finish within its test timeout");
  assert.ok(fs.existsSync(trace), "entrypoint must produce an observation trace");
  return { child, trace: JSON.parse(fs.readFileSync(trace, "utf-8")) as {
    chain: number; rpc: number; data: number; delays: number; unexpected: number;
  } };
}

test("valid Ethereum quantities include zero and values larger than Number.MAX_SAFE_INTEGER", (t) => {
  for (const result of ["0x0", "0xaF", "0x20000000000001"]) {
    assert.deepEqual(classifyQuantityResponse(true, { ...success, result }), {
      kind: "success", quantity: result,
    });
  }
  const { child, trace } = runEntry(t, [{ status: 200, body: { ...success, result: "0x20000000000001" } }]);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Latest Block: 9007199254740993 \(0x20000000000001\)/);
  assert.match(child.stdout, /Quickstart Completed Successfully/);
  assert.deepEqual(trace, { chain: 1, rpc: 1, data: 1, delays: 0, unexpected: 0 });
});

const rejected: Array<{ name: string; reply: Reply }> = [
  { name: "HTTP500 with result", reply: { status: 500, body: success } },
  { name: "wrong ID", reply: { status: 200, body: { ...success, id: 2 } } },
  { name: "missing ID", reply: { status: 200, body: { jsonrpc: "2.0", result: "0x10" } } },
  { name: "string ID", reply: { status: 200, body: { ...success, id: "1" } } },
  { name: "boolean ID", reply: { status: 200, body: { ...success, id: true } } },
  { name: "null ID success", reply: { status: 200, body: { ...success, id: null } } },
  { name: "null ID nonretryable error", reply: { status: 401, body: {
    ...admissionRetry, error: { ...admissionRetry.error, data: { retryable: false } },
  } } },
  { name: "null ID wrong version", reply: { status: 503, body: { ...admissionRetry, jsonrpc: "1.0" } } },
  { name: "null ID error and result", reply: { status: 200, body: { ...admissionRetry, result: "0x10" } } },
  { name: "wrong version", reply: { status: 200, body: { ...success, jsonrpc: "1.0" } } },
  { name: "nonhex result", reply: { status: 200, body: { ...success, result: "not-a-block-number" } } },
  { name: "leading zero", reply: { status: 200, body: { ...success, result: "0x00" } } },
  { name: "empty hex", reply: { status: 200, body: { ...success, result: "0x" } } },
  { name: "numeric result", reply: { status: 200, body: { ...success, result: 16 } } },
  { name: "error and result", reply: { status: 200, body: { ...success, error: retry.error } } },
  ...[null, false, 0, ""].map((error, i) => ({
    name: `falsy error member ${i}`, reply: { status: 200, body: { ...success, error } },
  })),
  { name: "null body", reply: { status: 200, body: null } },
  { name: "array body", reply: { status: 200, body: [success] } },
  { name: "missing result", reply: { status: 200, body: { jsonrpc: "2.0", id: 1 } } },
  { name: "malformed JSON", reply: { status: 200, invalidJson: true } },
  { name: "retry flag string", reply: { status: 503, body: {
    ...retry, error: { ...retry.error, data: { retryable: "true" } },
  } } },
  { name: "malformed error code", reply: { status: 503, body: {
    ...retry, error: { ...retry.error, code: "-32021" },
  } } },
  { name: "retry wrong ID", reply: { status: 503, body: { ...retry, id: 2 } } },
  { name: "nonretryable error", reply: { status: 200, body: {
    ...retry, error: { ...retry.error, data: { retryable: false } },
  } } },
];

test("invalid RPC responses stop the real entrypoint before Data API and completion", async (t) => {
  for (const { name, reply } of rejected) {
    await t.test(name, (st) => {
      const { child, trace } = runEntry(st, [reply]);
      assert.equal(child.status, 1);
      assert.doesNotMatch(child.stdout, /Quickstart Completed Successfully|Latest Block:/);
      assert.deepEqual(trace, { chain: 1, rpc: 1, data: 0, delays: 0, unexpected: 0 });
    });
  }
});

test("a valid retryable error may recover, preserving the bounded retry behavior", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: retry }, { status: 200, body: success }]);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Quickstart Completed Successfully/);
  assert.deepEqual(trace, { chain: 1, rpc: 2, data: 1, delays: 1, unexpected: 0 });
});

test("five retryable errors fail without a sixth call, final delay, or Data API call", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: retry }]);
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /Quickstart Completed Successfully|Latest Block:/);
  assert.deepEqual(trace, { chain: 1, rpc: 5, data: 0, delays: 4, unexpected: 0 });
});

test("a null-ID whole-request refusal can recover without counting as RPC success", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: admissionRetry }, { status: 200, body: success }]);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Quickstart Completed Successfully/);
  assert.equal((child.stdout.match(/Latest Block:/g) ?? []).length, 1);
  assert.deepEqual(trace, { chain: 1, rpc: 2, data: 1, delays: 1, unexpected: 0 });
});

test("null-ID whole-request refusals retain the five-attempt limit", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: {
    ...admissionRetry, error: { ...admissionRetry.error,
      message: "billing data temporarily unavailable", data: { reason: "billing_unavailable", retryable: true } },
  } }]);
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /Quickstart Completed Successfully|Latest Block:/);
  assert.deepEqual(trace, { chain: 1, rpc: 5, data: 0, delays: 4, unexpected: 0 });
});

const mainnet = { chain: "robinhood_mainnet", name: "Robinhood Chain", chain_id: 4663 };
const testnet = { chain: "robinhood_testnet", name: "Robinhood Chain Testnet", chain_id: 46630 };

test("a testnet listed first never displaces the exact mainnet entry", (t) => {
  const { child, trace } = runEntry(t, [{ status: 200, body: success }], {
    directory: { chains: [testnet, mainnet] },
  });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Verified Chain ID: 4663/);
  assert.match(child.stdout, /Selected: Robinhood Chain \(robinhood_mainnet, Chain ID 4663\)/);
  assert.deepEqual(trace, { chain: 1, rpc: 1, data: 1, delays: 0, unexpected: 0 });
});

test("missing, ambiguous or inconsistent mainnet directory entries stop before RPC", async (t) => {
  const cases = [
    { name: "only testnet", directory: { chains: [testnet] } },
    { name: "wrong numeric chain ID", directory: { chains: [{ ...mainnet, chain_id: 46630 }] } },
    { name: "string chain ID", directory: { chains: [{ ...mainnet, chain_id: "4663" }] } },
    { name: "duplicate canonical slug", directory: { chains: [mainnet, mainnet] } },
    { name: "lookalike display name", directory: { chains: [{ ...mainnet, chain: "another_chain" }] } },
    { name: "null directory", directory: null },
    { name: "nonarray chains", directory: { chains: {} } },
    { name: "invalid rows", directory: { chains: [null, [], "robinhood_mainnet"] } },
  ];
  for (const { name, directory } of cases) {
    await t.test(name, (st) => {
      const { child, trace } = runEntry(st, [{ status: 200, body: success }], { directory });
      assert.equal(child.status, 1);
      assert.doesNotMatch(child.stdout, /Verified Chain ID:|Latest Block:|Quickstart Completed Successfully/);
      assert.deepEqual(trace, { chain: 0, rpc: 0, data: 0, delays: 0, unexpected: 0 });
    });
  }
});

test("an endpoint reporting the testnet chain ID stops before block and Data API calls", (t) => {
  const { child, trace } = runEntry(t, [{ status: 200, body: success }], {
    chainReplies: [{ status: 200, body: { ...success, result: "0xb626" } }],
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /RPC chain ID does not match Robinhood mainnet/);
  assert.doesNotMatch(child.stdout, /Latest Block:|Quickstart Completed Successfully/);
  assert.deepEqual(trace, { chain: 1, rpc: 0, data: 0, delays: 0, unexpected: 0 });
});

test("chain-ID response validation rejects null-ID success before later calls", (t) => {
  const { child, trace } = runEntry(t, [{ status: 200, body: success }], {
    chainReplies: [{ status: 200, body: { ...success, id: null, result: "0x1237" } }],
  });
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /Verified Chain ID:|Latest Block:|Quickstart Completed Successfully/);
  assert.deepEqual(trace, { chain: 1, rpc: 0, data: 0, delays: 0, unexpected: 0 });
});

test("chain-ID verification preserves whole-request null-ID retry recovery", (t) => {
  const { child, trace } = runEntry(t, [{ status: 200, body: success }], {
    chainReplies: [{ status: 503, body: admissionRetry }, { status: 200, body: { ...success, result: "0x1237" } }],
  });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Verified Chain ID: 4663/);
  assert.deepEqual(trace, { chain: 2, rpc: 1, data: 1, delays: 1, unexpected: 0 });
});

test("chain-ID retry exhaustion stops after five calls without reading a block", (t) => {
  const { child, trace } = runEntry(t, [{ status: 200, body: success }], {
    chainReplies: [{ status: 503, body: admissionRetry }],
  });
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /Verified Chain ID:|Latest Block:|Quickstart Completed Successfully/);
  assert.deepEqual(trace, { chain: 5, rpc: 0, data: 0, delays: 4, unexpected: 0 });
});
