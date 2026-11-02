import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_ID_USAGE, parseChainIdArgs } from "../src/public-read-chain.ts";
import { readPublicHead } from "../src/public-read.ts";
import { formatPublicReadFailure } from "../src/public-read-errors.ts";

const entry = (chain = "bsc", chainId = 56) => ({
  chain, chain_id: chainId, jsonrpc: true,
  public: {
    url: `https://api.blockvectra.com/v1/${chain}/public`,
    methods: ["eth_chainId", "eth_blockNumber"],
  },
});
const rpc = (result: string) => ({ jsonrpc: "2.0", id: 1, result });
function script(bodies: unknown[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    assert.ok(calls.length <= bodies.length, "unexpected network phase");
    return new Response(JSON.stringify(bodies[calls.length - 1]));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("chain argument defaults to Robinhood and accepts canonical decimal IDs", () => {
  assert.equal(parseChainIdArgs([]), 4663);
  for (const value of ["1", "56", "4663", "9007199254740991"]) {
    assert.equal(parseChainIdArgs([value]), Number(value));
  }
});
for (const args of [["0"], ["-1"], ["+56"], ["056"], ["0x38"], ["56.0"], ["5e1"],
  [" 56"], ["56 "], ["56\n"], [""], ["NaN"], ["9007199254740992"], ["56", "1"]]) {
  test(`rejects malformed chain arguments ${JSON.stringify(args)}`, () => {
    assert.throws(() => parseChainIdArgs(args), { message: CHAIN_ID_USAGE });
    assert.equal(formatPublicReadFailure(new Error(CHAIN_ID_USAGE)), CHAIN_ID_USAGE);
  });
}

for (const [chain, chainId, quantity] of [["bsc", 56, "0x38"], ["ethereum", 1, "0x1"]] as const) {
  test(`reads selected ${chain} with no credentials and at most three serial requests`, async () => {
    const { calls, fetchImpl } = script([{ chains: [entry("robinhood_mainnet", 4663), entry(chain, chainId)] }, rpc(quantity), rpc("0x2a")]);
    assert.deepEqual(await readPublicHead(fetchImpl, true, chainId), { chain, chainId, blockNumber: "42" });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://api.blockvectra.com/v1/chains");
    for (const [i, method] of ["eth_chainId", "eth_blockNumber"].entries()) {
      const call = calls[i + 1];
      assert.equal(call.url, `https://api.blockvectra.com/v1/${chain}/public`);
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.redirect, "error");
      assert.deepEqual(JSON.parse(String(call.init.body)), { jsonrpc: "2.0", id: 1, method, params: [] });
    }
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("User-Agent"), "BlockVectraAgentQuickstart/1 BlockVectraQA/1");
      for (const name of ["authorization", "x-api-key", "cookie"]) assert.equal(headers.has(name), false);
    }
  });
}

for (const [label, entries] of [
  ["missing ID", [entry("ethereum", 1)]],
  ["string ID", [{ ...entry(), chain_id: "56" }]],
  ["duplicate ID", [entry(), entry("another", 56)]],
  ["duplicate slug", [entry(), entry("bsc", 1)]],
  ["path traversal", [entry("../bsc")]],
  ["query in slug", [entry("bsc?key=secret")]],
  ["newline in slug", [entry("bsc\n")]],
  ["non-EVM", [{ ...entry(), jsonrpc: false }]],
  ["no public metadata", [{ ...entry(), public: null }]],
  ["external endpoint", [{ ...entry(), public: { ...entry().public, url: "https://example.invalid/rpc" } }]],
  ["wrong chain endpoint", [{ ...entry(), public: entry("ethereum", 1).public }]],
  ["keyed endpoint", [{ ...entry(), public: { ...entry().public, url: "https://api.blockvectra.com/v1/bsc" } }]],
  ["query on endpoint", [{ ...entry(), public: { ...entry().public, url: `${entry().public.url}?key=secret` } }]],
  ["missing method", [{ ...entry(), public: { ...entry().public, methods: ["eth_blockNumber"] } }]],
] as Array<[string, unknown[]]>) {
  test(`selected chain rejects ${label} after only the directory request`, async () => {
    const { calls, fetchImpl } = script([{ chains: entries }]);
    await assert.rejects(readPublicHead(fetchImpl, false, 56));
    assert.equal(calls.length, 1);
  });
}

test("selected chain verifies the caller's ID before reading any head", async () => {
  const { calls, fetchImpl } = script([{ chains: [entry()] }, rpc("0x1")]);
  await assert.rejects(readPublicHead(fetchImpl, false, 56), /did not match the requested chain ID/);
  assert.equal(calls.length, 2);
});

for (const chainId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid API chain ID ${chainId} sends no HTTP requests`, async () => {
    const { calls, fetchImpl } = script([]);
    await assert.rejects(readPublicHead(fetchImpl, false, chainId), /Invalid expected chain ID/);
    assert.equal(calls.length, 0);
  });
}
