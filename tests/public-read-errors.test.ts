import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatPublicReadFailure } from "../src/public-read-errors.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SECRET = "synthetic-secret-do-not-print";
const DIRECTORY = { chains: [{
  chain: "robinhood_mainnet", chain_id: 4663, jsonrpc: true,
  public: {
    url: "https://api.blockvectra.com/v1/robinhood_mainnet/public",
    methods: ["eth_chainId", "eth_blockNumber"],
  },
}] };

function runCli(failureAt: number | null, unexpectedError = false) {
  const expectedCalls = failureAt === null ? 3 : failureAt + 1;
  const script = `
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init.headers);
      if (headers.has('authorization') || headers.has('x-api-key'))
        throw new Error('Unexpected credential header');
      const index = calls++;
      if (index === ${JSON.stringify(failureAt)}) {
        if (${unexpectedError}) throw new Error(${JSON.stringify(SECRET)});
        return new Response(${JSON.stringify(SECRET)}, { status: 429 });
      }
      if (index >= 3) throw new Error('Unexpected additional request');
      const body = index === 0 ? ${JSON.stringify(DIRECTORY)} :
        { jsonrpc: '2.0', id: 1, result: index === 1 ? '0x1237' : '0x10' };
      return new Response(JSON.stringify(body));
    };
    process.on('beforeExit', () => {
      if (calls !== ${expectedCalls}) {
        console.error('Unexpected request count: ' + calls);
        process.exitCode = 90;
      }
    });
    await import('./src/public-read-cli.ts');
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: ROOT, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, BLOCKVECTRA_API_KEY: SECRET, AGENT_PRIVATE_KEY: SECRET },
  });
}

for (const [index, phase] of [
  [0, "Chain directory"], [1, "Public RPC eth_chainId"], [2, "Public RPC eth_blockNumber"],
] as const) {
  test(`CLI identifies HTTP 429 at ${phase} and stops without retrying`, () => {
    const result = runCli(index);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`${phase}.*HTTP 429`));
    assert.match(result.stderr, /does not retry/);
    assert.equal(result.stderr.includes(SECRET), false);
  });
}

test("CLI preserves successful JSON output and exactly three requests", () => {
  const result = runCli(null);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    chain: "robinhood_mainnet", chainId: 4663, blockNumber: "16",
  });
});

test("CLI does not expose an unexpected transport exception or credentials", () => {
  const result = runCli(0, true);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Public read failed: could not read the selected chain head.\n");
});

test("timeout diagnostics identify the phase without disclosing arbitrary errors", () => {
  for (const phase of ["Chain directory", "Public RPC eth_chainId", "Public RPC eth_blockNumber"]) {
    for (const part of ["request", "response"]) {
      const message = formatPublicReadFailure(new Error(`${phase} ${part} timed out`));
      assert.ok(message.includes(`${phase} ${part} timed out`));
      assert.match(message, /does not retry/);
    }
  }
});

test("other HTTP statuses retain the phase and safe status only", () => {
  assert.match(formatPublicReadFailure(new Error("Public RPC eth_chainId failed (HTTP 503)")), /eth_chainId returned HTTP 503/);
});

test("unrecognized and suffix-injected errors retain the generic fallback", () => {
  const fallback = "Public read failed: could not read the selected chain head.";
  for (const error of [
    SECRET, { message: SECRET }, null, new Error(SECRET),
    new Error(`Chain directory request failed (HTTP 429) ${SECRET}`),
    new Error(`Public RPC eth_chainId request timed out\n${SECRET}`),
    new Error("Chain directory request failed (HTTP 429)\n"),
    new Error("Public RPC eth_chainId request timed out\n"),
    new Error("Public RPC eth_sendRawTransaction failed (HTTP 429)"),
  ]) assert.equal(formatPublicReadFailure(error), fallback);
});
