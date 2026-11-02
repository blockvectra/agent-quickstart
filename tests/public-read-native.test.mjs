import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
const nativeSupported = (major === 22 && minor >= 18) || major > 24 || (major === 24 && minor >= 12);
const files = ["public-read-cli.ts", "public-read.ts", "public-read-chain.ts", "public-read-errors.ts", "chain-directory.ts", "rpc-response.ts"];
const fixture = `
import assert from "node:assert/strict";
let calls = 0;
const scenario = process.env.NATIVE_READ_CASE;
const selected = scenario === "bsc" || scenario === "bsc-wrong-chain";
const invalid = scenario === "invalid-argument" || scenario === "extra-argument";
const chain = selected ? "bsc" : "robinhood_mainnet";
const chainId = selected ? 56 : 4663;
const endpoint = "https://api.blockvectra.com/v1/" + chain + "/public";
const expected = invalid ? 0 : scenario === "success" || scenario === "bsc" ? 3 : scenario.endsWith("wrong-chain") ? 2 : 1;
process.on("exit", () => assert.equal(calls, expected));
globalThis.fetch = async (url, init) => {
  calls++;
  const headers = new Headers(init.headers);
  assert.equal(headers.get("User-Agent"), "BlockVectraAgentQuickstart/1 BlockVectraQA/1");
  assert.equal(headers.has("x-api-key"), false);
  assert.equal(headers.has("authorization"), false);
  if (calls === 1) {
    assert.equal(url, "https://api.blockvectra.com/v1/chains");
    assert.equal(init.method, "GET");
    if (scenario === "unavailable") return new Response("untrusted upstream body", { status: 503 });
    return new Response(JSON.stringify({ chains: [{ chain, chain_id: chainId, jsonrpc: true, public: { url: endpoint, methods: ["eth_chainId", "eth_blockNumber"] } }] }));
  }
  assert.equal(url, endpoint);
  assert.equal(init.method, "POST");
  const request = JSON.parse(init.body);
  assert.equal(request.method, calls === 2 ? "eth_chainId" : "eth_blockNumber");
  const result = calls === 2 ? (scenario.endsWith("wrong-chain") ? "0x1" : selected ? "0x38" : "0x1237") : "0x2a";
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
};
`;

for (const scenario of ["success", "unavailable", "wrong-chain", "bsc", "bsc-wrong-chain", "invalid-argument", "extra-argument"]) {
  test(`native Node keyless reader without installed dependencies: ${scenario}`, { skip: !nativeSupported }, async () => {
    const tempRoot = path.join(root, ".tmp");
    await mkdir(tempRoot, { recursive: true });
    const work = await mkdtemp(path.join(tempRoot, "native-reader-"));
    try {
      await mkdir(path.join(work, "src"));
      for (const file of files) await copyFile(path.join(root, "src", file), path.join(work, "src", file));
      await writeFile(path.join(work, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(path.join(work, "fetch-fixture.mjs"), fixture);
      await assert.rejects(access(path.join(work, "node_modules")), { code: "ENOENT" });
      const result = spawnSync(process.execPath, ["--import", path.join(work, "fetch-fixture.mjs"), "src/public-read-cli.ts", ...(scenario.startsWith("bsc") ? ["56"] : scenario === "invalid-argument" ? ["56\n"] : scenario === "extra-argument" ? ["56", "1"] : [])], {
        cwd: work,
        env: { PATH: process.env.PATH ?? "", BLOCKVECTRA_INTERNAL_QA: "1", NATIVE_READ_CASE: scenario },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (scenario === "success" || scenario === "bsc") {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { chain: scenario === "bsc" ? "bsc" : "robinhood_mainnet", chainId: scenario === "bsc" ? 56 : 4663, blockNumber: "42" });
        assert.equal(result.stderr, "");
      } else {
        assert.equal(result.status, 1, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, scenario === "invalid-argument" || scenario === "extra-argument"
          ? "Usage: node src/public-read-cli.ts [positive-decimal-chain-id]\n"
          : scenario === "unavailable"
          ? "Public read failed: Chain directory returned HTTP 503. Check service availability before trying again manually; this command does not retry.\n"
          : "Public read failed: could not read the selected chain head.\n");
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
