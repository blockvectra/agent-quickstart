import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Dummy credentials are fixture inputs, never printed by the executable.
const API_KEY = "rgw_fixture_not_a_real_credential_0123456789";
const SESSION = "rgs_fixture_not_a_real_session_0123456789";
const entry = new URL("../src/index.ts", import.meta.url).href;
const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).pathname;
function run(directory: string, options: { apiKey?: string; denySave?: boolean; revokeFails?: boolean; expectedStatus?: number } = {}) {
  const callsFile = path.join(directory, "calls.json");
  fs.writeFileSync(callsFile, "[]");
  const env = { ...process.env };
  delete env.AGENT_PRIVATE_KEY;
  delete env.BLOCKVECTRA_API_KEY;
  if (options.apiKey) env.BLOCKVECTRA_API_KEY = options.apiKey;
  const child = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", `
    import fs from 'node:fs';
    const calls = [];
    if (${JSON.stringify(options.denySave ?? false)}) {
      const open = fs.openSync;
      fs.openSync = (file, ...args) => {
        if (String(file).endsWith('.agent-key.json')) throw new Error('fixture write denied');
        return open(file, ...args);
      };
    }
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({url, method: init.method || 'GET'});
      fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
      let body;
      if (url.endsWith('/auth/siwe/challenge')) body = {message: 'offline fixture challenge'};
      else if (url.endsWith('/auth/siwe/login')) body = {session: {token: ${JSON.stringify(SESSION)}}, account_created: false};
      else if (url.endsWith('/revoke')) return new Response('{}', {status: ${JSON.stringify(options.revokeFails ? 503 : 200)}});
      else if (url.endsWith('/keys')) body = {key: {key_id: 'k_fixture', status: 'active'}, api_key: ${JSON.stringify(API_KEY)}};
      else if (url.endsWith('/chains')) body = {chains: [{chain: 'robinhood_mainnet', chain_id: 4663}]};
      else if (url.endsWith('/status/freshness')) body = {meta: {chain: 'robinhood_mainnet'}, data: []};
      else if (url.endsWith('/robinhood_mainnet')) {
        if (new Headers(init.headers).get('x-api-key') !== ${JSON.stringify(API_KEY)}) throw new Error('wrong fixture credential');
        const request = JSON.parse(init.body);
        body = {jsonrpc: '2.0', id: 1, result: request.method === 'eth_chainId' ? '0x1237' : '0x2a'};
      } else throw new Error('unplanned fixture request');
      return new Response(JSON.stringify(body));
    };
    await import(${JSON.stringify(entry)});
  `], {cwd: directory, env, encoding: 'utf8', timeout: 5000});
  assert.equal(child.status, options.expectedStatus ?? 0, child.stderr);
  assert.ok(!(child.stdout + child.stderr).includes(API_KEY));
  assert.ok(!(child.stdout + child.stderr).includes(SESSION));
  const calls = JSON.parse(fs.readFileSync(callsFile, 'utf8')) as Array<{url: string; method: string}>;
  return {calls, stdout: child.stdout, stderr: child.stderr};
}

test("two complete offline CLI runs create one key and reuse its exact saved bytes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstart-key-reuse-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const {calls: first} = run(directory);
  assert.equal(first.filter(c => c.url.endsWith('/keys')).length, 1);
  const keyFile = path.join(directory, '.agent-key.json');
  assert.ok(fs.existsSync(keyFile), 'first run must persist the reusable key');
  const bytes = fs.readFileSync(keyFile);
  if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  const {calls: second} = run(directory);
  assert.equal(second.length, 4);
  assert.equal(second.filter(c => c.url.includes('/auth/') || c.url.endsWith('/keys')).length, 0);
  assert.ok(fs.readFileSync(keyFile).equals(bytes));
});

for (const revokeFails of [false, true]) {
  test(`a local save failure attempts exactly one revoke (accepted=${!revokeFails}) and stops before RPC`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstart-key-save-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const {calls, stderr} = run(directory, {denySave: true, revokeFails, expectedStatus: 1});
    assert.equal(calls.length, 4);
    assert.equal(calls.filter(c => c.url.endsWith('/keys/k_fixture/revoke')).length, 1);
    assert.equal(calls.filter(c => c.url.endsWith('/chains')).length, 0);
    assert.match(stderr, revokeFails ? /not confirmed/ : /Revoke request accepted/);
    assert.ok(!fs.existsSync(path.join(directory, '.agent-key.json')));
  });
}

test('a damaged saved credential stops before login; explicit environment key bypasses it unchanged', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstart-key-damaged-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  run(directory);
  const keyFile = path.join(directory, '.agent-key.json');
  fs.writeFileSync(keyFile, '{broken');
  const rejected = run(directory, {expectedStatus: 1});
  assert.equal(rejected.calls.length, 0);
  assert.match(rejected.stderr, /Invalid saved API key/);
  const injected = run(directory, {apiKey: API_KEY});
  assert.equal(injected.calls.length, 4);
  assert.equal(fs.readFileSync(keyFile, 'utf8'), '{broken');
});
