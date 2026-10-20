import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadOrCreateWallet } from "../src/wallet.js";

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-wallet-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, walletFile: path.join(directory, ".agent-wallet.json") };
}

test("first run persists one identity with private POSIX permissions; rerun reuses its exact bytes", (t) => {
  const { walletFile } = fixture(t);
  const first = loadOrCreateWallet({ walletFile });
  const bytes = fs.readFileSync(walletFile);
  const second = loadOrCreateWallet({ walletFile });
  assert.equal(first.source, "created");
  assert.equal(second.source, "saved");
  assert.equal(second.account.address, first.account.address);
  assert.ok(fs.readFileSync(walletFile).equals(bytes), "rerun must not rewrite wallet bytes");
  if (process.platform !== "win32") assert.equal(fs.statSync(walletFile).mode & 0o777, 0o600);
});

test("legacy privateKey remains supported without rewriting the file", (t) => {
  const { walletFile } = fixture(t);
  const key = generatePrivateKey();
  const original = JSON.stringify({ privateKey: key });
  fs.writeFileSync(walletFile, original);
  const actual = loadOrCreateWallet({ walletFile });
  assert.equal(actual.account.address, privateKeyToAccount(key).address);
  assert.ok(fs.readFileSync(walletFile, "utf-8") === original);
});

test("matching aliases and a lowercase address are accepted without rewriting", (t) => {
  const { walletFile } = fixture(t);
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const original = JSON.stringify({ private_key: key, privateKey: key, address: account.address.toLowerCase() });
  fs.writeFileSync(walletFile, original);
  assert.equal(loadOrCreateWallet({ walletFile }).account.address, account.address);
  assert.ok(fs.readFileSync(walletFile, "utf-8") === original);
});

test("invalid saved identities fail without changing their original bytes or exposing them", async (t) => {
  const key = generatePrivateKey();
  const cases = [
    ["invalid JSON", "{broken"],
    ["null", "null"],
    ["array", "[]"],
    ["missing key", "{}"],
    ["wrong key type", JSON.stringify({ private_key: 123 })],
    ["empty key", JSON.stringify({ private_key: "" })],
    ["zero scalar", JSON.stringify({ private_key: `0x${"0".repeat(64)}` })],
    ["out of range scalar", JSON.stringify({ private_key: `0x${"f".repeat(64)}` })],
    ["invalid primary with valid legacy", JSON.stringify({ private_key: null, privateKey: key })],
    ["conflicting aliases", JSON.stringify({ private_key: key, privateKey: generatePrivateKey() })],
    ["mismatched address", JSON.stringify({ private_key: key, address: "0xnot-the-saved-address" })],
  ];
  for (const [name, original] of cases) {
    await t.test(name!, (st) => {
      const { walletFile } = fixture(st);
      fs.writeFileSync(walletFile, original!);
      assert.throws(() => loadOrCreateWallet({ walletFile }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Invalid saved agent wallet. Preserve the file and restore a trusted backup.");
        assert.ok(!error.message.includes(key), "error must not contain a private key");
        return true;
      });
      assert.ok(fs.readFileSync(walletFile, "utf-8") === original, "invalid wallet bytes must be preserved");
    });
  }
});

test("an explicitly injected identity takes precedence without touching a saved file", (t) => {
  const { walletFile } = fixture(t);
  fs.writeFileSync(walletFile, "{broken");
  const privateKey = generatePrivateKey();
  const actual = loadOrCreateWallet({ walletFile, privateKey });
  assert.equal(actual.source, "environment");
  assert.equal(actual.account.address, privateKeyToAccount(privateKey).address);
  assert.ok(fs.readFileSync(walletFile, "utf-8") === "{broken");
});

test("invalid injected configuration never falls back to the saved or a generated identity", (t) => {
  const { walletFile } = fixture(t);
  const original = JSON.stringify({ private_key: generatePrivateKey() });
  fs.writeFileSync(walletFile, original);
  for (const privateKey of ["", "not-a-key", `0x${"0".repeat(64)}`]) {
    assert.throws(() => loadOrCreateWallet({ walletFile, privateKey }), {
      message: "Invalid AGENT_PRIVATE_KEY. Check the injected configuration.",
    });
    assert.ok(fs.readFileSync(walletFile, "utf-8") === original);
  }
});

test("a read error does not become a new identity", (t) => {
  const { walletFile } = fixture(t);
  fs.mkdirSync(walletFile);
  assert.throws(() => loadOrCreateWallet({ walletFile }), /Cannot read the saved agent wallet/);
  assert.ok(fs.statSync(walletFile).isDirectory());
});

test("a write error stops instead of using an identity that was not saved", (t) => {
  const { directory } = fixture(t);
  const walletFile = path.join(directory, "missing-parent", ".agent-wallet.json");
  assert.throws(() => loadOrCreateWallet({ walletFile }), /Cannot create the agent wallet/);
  assert.ok(!fs.existsSync(walletFile));
});

test("a competing creator wins the exclusive create without being overwritten", (t) => {
  const { walletFile } = fixture(t);
  const winnerKey = generatePrivateKey();
  const original = JSON.stringify({ private_key: winnerKey });
  const write = fs.writeFileSync;
  // Create the competing file exactly between this caller's read and exclusive write.
  fs.writeFileSync = (...args: Parameters<typeof fs.writeFileSync>) => {
    if (args[0] === walletFile && !fs.existsSync(walletFile)) write(walletFile, original, { mode: 0o600 });
    return write(...args);
  };
  try {
    const actual = loadOrCreateWallet({ walletFile });
    assert.equal(actual.source, "saved");
    assert.equal(actual.account.address, privateKeyToAccount(winnerKey).address);
    assert.ok(fs.readFileSync(walletFile, "utf-8") === original, "competing identity must never be overwritten");
  } finally {
    fs.writeFileSync = write;
  }
});

test("a competing incomplete file fails closed without overwriting it", (t) => {
  const { walletFile } = fixture(t);
  const write = fs.writeFileSync;
  fs.writeFileSync = (...args: Parameters<typeof fs.writeFileSync>) => {
    if (args[0] === walletFile && !fs.existsSync(walletFile)) write(walletFile, "");
    return write(...args);
  };
  try {
    assert.throws(() => loadOrCreateWallet({ walletFile }), /Invalid saved agent wallet/);
    assert.equal(fs.statSync(walletFile).size, 0);
  } finally {
    fs.writeFileSync = write;
  }
});

test("the executable stops before any fetch and preserves a damaged wallet", (t) => {
  const { directory, walletFile } = fixture(t);
  fs.writeFileSync(walletFile, "{broken");
  const marker = path.join(directory, "fetch-was-called");
  const entry = new URL("../src/index.ts", import.meta.url).href;
  const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  delete env.AGENT_PRIVATE_KEY;
  delete env.BLOCKVECTRA_API_KEY;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", `
    import fs from 'node:fs';
    globalThis.fetch = async () => {
      fs.writeFileSync(${JSON.stringify(marker)}, 'called');
      throw new Error('OFFLINE_NETWORK_BLOCKED');
    };
    await import(${JSON.stringify(entry)});
  `], { cwd: directory, env, encoding: "utf-8", timeout: 5_000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Invalid saved agent wallet/);
  assert.ok(!fs.existsSync(marker), "no challenge or login may happen after a wallet error");
  assert.ok(fs.readFileSync(walletFile, "utf-8") === "{broken");
});
