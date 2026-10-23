import assert from "node:assert/strict";
import { test } from "node:test";
import { readFreshness } from "../src/data-freshness.js";

const CHAIN = "robinhood_mainnet";
const SECRET = "synthetic-secret-value-do-not-echo";

const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const envelope = (data: unknown, meta: unknown = { chain: CHAIN }) => ({ data, meta });
const row = (extra: Record<string, unknown> = {}) =>
  ({ dataset: "blocks", max_block_number: 100, seconds_behind: 0, ...extra });

test("valid mainnet response decodes only consumed fields", async () => {
  const decoded = await readFreshness(
    response(envelope([row({ future_field: "ignored" })], { chain: CHAIN, stale: true, extra: 1 })),
    CHAIN);
  assert.deepEqual(decoded, [{ dataset: "blocks", max_block_number: 100, seconds_behind: 0 }]);
});

test("empty data list, zero, negative, unsafe and nullable integers are accepted", async () => {
  assert.deepEqual(await readFreshness(response(envelope([])), CHAIN), []);

  const decoded = await readFreshness(response(envelope([
    row({ dataset: "nulls", max_block_number: null, seconds_behind: null }),
    row({ dataset: "zero", max_block_number: 0, seconds_behind: 0 }),
    row({ dataset: "negative", max_block_number: -7, seconds_behind: -12 }),
    row({ dataset: "unsafe", max_block_number: Number.MAX_SAFE_INTEGER + 1, seconds_behind: Number.MAX_SAFE_INTEGER + 2 }),
  ])), CHAIN);

  assert.equal(decoded[0].max_block_number, null);
  assert.equal(decoded[0].seconds_behind, null);
  assert.equal(decoded[1].max_block_number, 0);
  assert.equal(decoded[1].seconds_behind, 0);
  assert.equal(decoded[2].max_block_number, -7);
  assert.equal(decoded[2].seconds_behind, -12);
  assert.equal(decoded[3].max_block_number, Number.MAX_SAFE_INTEGER + 1);
  assert.equal(decoded[3].seconds_behind, Number.MAX_SAFE_INTEGER + 2);
});

test("a chain mismatch is rejected", async () => {
  await assert.rejects(readFreshness(response(envelope([], { chain: "ethereum_mainnet" })), CHAIN), /chain mismatch/);
});

test("missing or non-object meta is rejected", async () => {
  for (const meta of [undefined, null, [], "meta", 1]) {
    await assert.rejects(readFreshness(response({ data: [], meta }), CHAIN), /meta must be an object/);
  }
});

test("non-object envelopes are rejected", async () => {
  for (const payload of [null, [], "text", 1, true]) {
    await assert.rejects(readFreshness(response(JSON.stringify(payload)), CHAIN), /envelope must be an object/);
  }
});

test("non-array data is rejected", async () => {
  for (const data of [undefined, null, {}, "data", 1]) {
    await assert.rejects(readFreshness(response(envelope(data)), CHAIN), /data must be an array/);
  }
});

test("bad rows, missing fields and non-integers are rejected", async () => {
  const badRows: unknown[] = [
    null, [], "row", 1,
    { max_block_number: 1, seconds_behind: 0 },
    { dataset: 1, max_block_number: 1, seconds_behind: 0 },
    { dataset: "blocks", seconds_behind: 0 },
    { dataset: "blocks", max_block_number: "1", seconds_behind: 0 },
    { dataset: "blocks", max_block_number: 1.5, seconds_behind: 0 },
    { dataset: "blocks", max_block_number: true, seconds_behind: 0 },
    { dataset: "blocks", max_block_number: 1 },
    { dataset: "blocks", max_block_number: 1, seconds_behind: "0" },
    { dataset: "blocks", max_block_number: 1, seconds_behind: 0.5 },
    { dataset: "blocks", max_block_number: 1, seconds_behind: false },
  ];
  for (const bad of badRows) {
    await assert.rejects(readFreshness(response(envelope([bad])), CHAIN), /malformed/);
  }
});

test("unknown dataset names and extra fields are allowed", async () => {
  const decoded = await readFreshness(response(envelope([
    row({ dataset: "a_future_dataset", extra: { nested: true }, stale: false }),
  ])), CHAIN);
  assert.deepEqual(decoded, [{ dataset: "a_future_dataset", max_block_number: 100, seconds_behind: 0 }]);
});

test("non-JSON and HTTP 401/503 errors keep status without echoing upstream bodies", async () => {
  await assert.rejects(
    () => readFreshness(response(`<html>${SECRET}</html>`), CHAIN),
    (error: Error) => error.message.includes("HTTP 200") &&
      error.message.includes("not valid JSON") && !error.message.includes(SECRET));

  for (const status of [401, 503]) {
    await assert.rejects(
      () => readFreshness(response(`{"error":"${SECRET}"}`, status), CHAIN),
      (error: Error) => error.message.includes(`HTTP ${status}`) &&
        !error.message.includes(SECRET));
  }
});

test("malformed structure errors do not echo upstream field values", async () => {
  await assert.rejects(
    () => readFreshness(response(envelope([row({ dataset: SECRET, max_block_number: "100" })])), CHAIN),
    (error: Error) => error.message.includes("HTTP 200") &&
      error.message.includes("max_block_number") && !error.message.includes(SECRET));
});
