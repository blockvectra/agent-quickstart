import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const stages = ["challenge", "login", "keys", "chains", "eth_chainId", "eth_blockNumber", "freshness"];
const entry = new URL("../src/index.ts", import.meta.url).href;
const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).pathname;
const apiKey = "rgw_deadline_fixture_not_a_real_credential_0123456789";
const session = "rgs_deadline_fixture_not_a_real_session_0123456789";

for (const stalledStage of stages) {
  for (const stalledPart of ["headers", "body"]) {
    test(`${stalledStage}: a stalled ${stalledPart} aborts the CLI before any subsequent request`, async (t) => {
      const root = new URL("../.tmp/", import.meta.url);
      fs.mkdirSync(root, { recursive: true });
      const directory = fs.mkdtempSync(path.join(root.pathname, "deadline-"));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const calls: string[] = [];
      const server = http.createServer(async (request, response) => {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        const url = request.url!;
        const stage = url.endsWith("/robinhood_mainnet") ? JSON.parse(raw).method
          : url.endsWith("/status/freshness") ? "freshness" : url.split("/").at(-1)!;
        calls.push(stage);
        if (stage === stalledStage) {
          if (stalledPart === "body") {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.write('{"unfinished":');
          }
          return;
        }
        const body = stage === "challenge" ? { message: "offline fixture challenge" }
          : stage === "login" ? { session: { token: session }, account_created: false }
          : stage === "keys" ? { key: { key_id: "k_deadline", status: "active" }, api_key: apiKey }
          : stage === "chains" ? { chains: [{ chain: "robinhood_mainnet", chain_id: 4663 }] }
          : stage === "freshness" ? { meta: { chain: "robinhood_mainnet" }, data: [] }
          : { jsonrpc: "2.0", id: 1, result: stage === "eth_chainId" ? "0x1237" : "0x2a" };
        response.writeHead(200, { "Content-Type": "application/json" });
        // A healthy prefix may exceed the old blanket 100ms test deadline.
        if (stage === "challenge" && stalledStage !== "challenge") {
          setTimeout(() => response.end(JSON.stringify(body)), 200);
        } else {
          response.end(JSON.stringify(body));
        }
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      t.after(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const env = { ...process.env };
      delete env.AGENT_PRIVATE_KEY;
      delete env.BLOCKVECTRA_API_KEY;
      const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "-e", `
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        const issuedSignals = [];
        // The fresh CLI makes these seven requests serially, without retries.
        // Keep healthy prefixes on the native 15s budget; accelerate only the stall.
        AbortSignal.timeout = (ms) => {
          if (ms !== 15000) throw new Error('unexpected request deadline');
          const signal = timeout(issuedSignals.length === ${stages.indexOf(stalledStage)} ? 500 : ms);
          issuedSignals.push(signal);
          return signal;
        };
        let requestIndex = 0;
        const nativeFetch = globalThis.fetch;
        globalThis.fetch = (input, init) => {
          if (!(init?.signal instanceof AbortSignal) || init.signal !== issuedSignals[requestIndex++]) {
            throw new Error('request must forward its production timeout signal');
          }
          const url = new URL(String(input));
          if (!['console-api.blockvectra.com', 'api.blockvectra.com'].includes(url.hostname)) {
            throw new Error('unplanned request origin');
          }
          return nativeFetch('http://127.0.0.1:${address.port}' + url.pathname, init);
        };
        await import(${JSON.stringify(entry)});
      `], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
      t.diagnostic(`fixture child pid=${child.pid}`);
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      let guardKilled = false;
      const guard = setTimeout(() => { guardKilled = true; child.kill("SIGKILL"); }, 10000);
      t.after(() => { clearTimeout(guard); if (child.exitCode === null) child.kill("SIGKILL"); });
      const [code] = await once(child, "close");
      clearTimeout(guard);
      assert.equal(guardKilled, false, "request failed to abort; task-owned subprocess hit the safety guard");
      assert.equal(code, 1, output);
      assert.deepEqual(calls, stages.slice(0, stages.indexOf(stalledStage) + 1));
      assert.match(output, /Agent execution error:/);
      assert.doesNotMatch(output, /Quickstart Completed Successfully/);
      assert.ok(!output.includes(apiKey) && !output.includes(session), "must not print full credentials");
      assert.equal(fs.existsSync(path.join(directory, ".agent-key.json")), stages.indexOf(stalledStage) >= 3);
    });
  }
}
