import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { classifyBlockNumberResponse } from "../src/rpc-response.js";

const success = { jsonrpc: "2.0", id: 1, result: "0x10" };
const retry = {
  jsonrpc: "2.0", id: 1,
  error: { code: -32021, message: "synthetic retryable error", data: { retryable: true } },
};

type Reply = { status: number; body?: unknown; invalidJson?: boolean };

function runEntry(t: TestContext, replies: Reply[]) {
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
    const trace = { rpc: 0, data: 0, delays: 0, unexpected: 0 };
    process.on('exit', () => fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify(trace)));
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => {
      if (ms === 2000) { trace.delays++; return originalTimeout(fn, 0, ...args); }
      return originalTimeout(fn, ms, ...args);
    };
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/chains')) return Response.json({ chains: [
        { chain: 'robinhood_mainnet', name: 'Robinhood Chain', chain_id: 4663 }
      ] });
      if (String(url).endsWith('/robinhood_mainnet')) {
        const request = JSON.parse(options.body);
        if (request.jsonrpc !== '2.0' || request.id !== 1 || request.method !== 'eth_blockNumber' ||
          !Array.isArray(request.params) || request.params.length !== 0) throw Error('UNEXPECTED_RPC_REQUEST');
        const reply = replies[Math.min(trace.rpc++, replies.length - 1)];
        return reply.invalidJson
          ? new Response('{not-json', { status: reply.status })
          : Response.json(reply.body, { status: reply.status });
      }
      if (String(url).endsWith('/data/robinhood_mainnet/status/freshness')) {
        trace.data++;
        return Response.json({ data: [] });
      }
      trace.unexpected++;
      throw Error('UNEXPECTED_OFFLINE_ROUTE');
    };
    await import(${JSON.stringify(entry)});
  `], { cwd: directory, env, encoding: "utf-8", timeout: 10_000 });
  assert.ok(!child.error, "offline entrypoint must finish within its test timeout");
  assert.ok(fs.existsSync(trace), "entrypoint must produce an observation trace");
  return { child, trace: JSON.parse(fs.readFileSync(trace, "utf-8")) as {
    rpc: number; data: number; delays: number; unexpected: number;
  } };
}

test("valid Ethereum quantities include zero and values larger than Number.MAX_SAFE_INTEGER", (t) => {
  for (const result of ["0x0", "0xaF", "0x20000000000001"]) {
    assert.deepEqual(classifyBlockNumberResponse(true, { ...success, result }), {
      kind: "success", blockNumber: result,
    });
  }
  const { child, trace } = runEntry(t, [{ status: 200, body: { ...success, result: "0x20000000000001" } }]);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Latest Block: 9007199254740993 \(0x20000000000001\)/);
  assert.match(child.stdout, /Quickstart Completed Successfully/);
  assert.deepEqual(trace, { rpc: 1, data: 1, delays: 0, unexpected: 0 });
});

const rejected: Array<{ name: string; reply: Reply }> = [
  { name: "HTTP500 with result", reply: { status: 500, body: success } },
  { name: "wrong ID", reply: { status: 200, body: { ...success, id: 2 } } },
  { name: "missing ID", reply: { status: 200, body: { jsonrpc: "2.0", result: "0x10" } } },
  { name: "string ID", reply: { status: 200, body: { ...success, id: "1" } } },
  { name: "boolean ID", reply: { status: 200, body: { ...success, id: true } } },
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
      assert.deepEqual(trace, { rpc: 1, data: 0, delays: 0, unexpected: 0 });
    });
  }
});

test("a valid retryable error may recover, preserving the bounded retry behavior", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: retry }, { status: 200, body: success }]);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Quickstart Completed Successfully/);
  assert.deepEqual(trace, { rpc: 2, data: 1, delays: 1, unexpected: 0 });
});

test("five retryable errors fail without a sixth call, final delay, or Data API call", (t) => {
  const { child, trace } = runEntry(t, [{ status: 503, body: retry }]);
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /Quickstart Completed Successfully|Latest Block:/);
  assert.deepEqual(trace, { rpc: 5, data: 0, delays: 4, unexpected: 0 });
});
