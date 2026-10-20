import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBalancePages, decodeBalancePage } from "../src/wallet-balances.js";

const CHAIN = "robinhood_mainnet";
const T1 = "0x" + "1".repeat(40);
const T2 = "0x" + "2".repeat(40);
const T3 = "0x" + "3".repeat(40);
const row = (token: string, extra: Record<string, unknown> = {}) =>
  ({ token, balance: "5", symbol: "AAA", decimals: 18, ...extra });
const meta = (refreshed_at: string | null = "2026-10-20T00:00:00Z", extra = {}) =>
  ({ chain: CHAIN, chain_slug: "ROBINHOOD_MAINNET", as_of_block: 7, coverage: "full", refreshed_at, ...extra });
const page = (data: unknown[], next?: unknown, m: unknown = meta()) =>
  ({ data, meta: m, ...(next === undefined ? {} : { next_cursor: next }) });

function reader(pages: unknown[]) {
  const seen: (string | undefined)[] = [];
  return {
    seen,
    read: async (cursor?: string) => {
      seen.push(cursor);
      const p = pages[seen.length - 1];
      if (p instanceof Error) throw p;
      return p;
    },
  };
}

test("valid empty and non-empty pages", () => {
  assert.deepEqual(decodeBalancePage(page([]), CHAIN).data, []);
  const m = meta("2026-10-20T00:00:00Z", { future_field: { a: 1 } });
  const decoded = decodeBalancePage(page([row(T1)], undefined, m), CHAIN);
  assert.equal(decoded.data.length, 1);
  assert.equal(decoded.meta.future_field !== undefined, true);
  assert.equal(decoded.next_cursor, undefined);
});

test("balance above 2^53 stays an exact string", () => {
  const big = "340282366920938463463374607431768211455";
  const [r] = decodeBalancePage(page([row(T1, { balance: big })]), CHAIN).data;
  assert.equal(r.balance, big);
});

test("decimals 0 differs from null; null symbol preserved", () => {
  const [a, b] = decodeBalancePage(
    page([row(T1, { decimals: 0, symbol: null }), row(T2, { decimals: null })]), CHAIN).data;
  assert.equal(a.decimals, 0);
  assert.equal(a.symbol, null);
  assert.equal(b.decimals, null);
});

test("missing metadata, bad rows and no coercion are rejected", () => {
  const bad: Record<string, unknown>[] = [
    { token: T1, balance: "5", decimals: 1 },
    { token: T1, balance: "5", symbol: "A" },
    row(T1, { balance: 5 }),
    row(T1, { balance: "1.5" }),
    row(T1, { balance: "-1" }),
    row(T1, { balance: "0x10" }),
    row(T1, { decimals: "18" }),
    row(T1, { decimals: 256 }),
    row(T1, { decimals: -1 }),
    row(T1, { decimals: 1.5 }),
    row(T1, { symbol: 1 }),
    row("0x123"),
    row(T1, { token: undefined }),
  ];
  for (const r of bad) assert.throws(() => decodeBalancePage(page([r]), CHAIN), /malformed/);
  assert.throws(() => decodeBalancePage(page([null]), CHAIN), /malformed/);
});

test("bare array, HTML-like object and bad envelope are malformed", () => {
  for (const raw of [[row(T1)], { html: "<html>" }, null, "x", { data: {}, meta: meta() },
    { data: [] }, { data: [], meta: [] }]) {
    assert.throws(() => decodeBalancePage(raw, CHAIN), /malformed/);
  }
});

test("chain mismatch is rejected", () => {
  assert.throws(() => decodeBalancePage(page([], undefined, meta()), "other"), /chain mismatch/);
  assert.throws(() => decodeBalancePage(page([], undefined, { ...meta(), chain: "ROBINHOOD_MAINNET" }), CHAIN), /chain mismatch/);
});

test("refreshed_at must be present; null is valid", () => {
  const { refreshed_at: _omit, ...noStamp } = meta();
  assert.throws(() => decodeBalancePage(page([], undefined, noStamp), CHAIN), /refreshed_at/);
  assert.throws(() => decodeBalancePage(page([], undefined, { ...noStamp, refreshed_at: undefined }), CHAIN), /refreshed_at/);
  assert.throws(() => decodeBalancePage(page([], undefined, meta(1 as never)), CHAIN), /refreshed_at/);
  assert.equal(decodeBalancePage(page([], undefined, meta(null)), CHAIN).meta.refreshed_at, null);
});

test("opaque cursors round-trip exactly; last page omits next_cursor", async () => {
  const c1 = "a/b?c=d&e=%20+=#é/../";
  const c2 = " ";
  const r = reader([page([row(T1)], c1), page([row(T2)], c2), page([row(T3)])]);
  const out = await collectBalancePages(r.read, CHAIN);
  assert.deepEqual(r.seen, [undefined, c1, c2]);
  assert.deepEqual(out.balances.map((b) => b.token), [T1, T2, T3]);
  assert.equal(out.pages.length, 3);
});

test("next_cursor null is malformed, not a last page", async () => {
  const r = reader([page([row(T1)], null)]);
  await assert.rejects(collectBalancePages(r.read, CHAIN), /next_cursor/);
});

test("later read failure rejects the whole collection", async () => {
  const r = reader([page([row(T1)], "c1"), new Error("HTTP 503")]);
  await assert.rejects(collectBalancePages(r.read, CHAIN), /HTTP 503/);
});

test("later decode failure rejects the whole collection", async () => {
  const r = reader([page([row(T1)], "c1"), [row(T2)]]);
  await assert.rejects(collectBalancePages(r.read, CHAIN), /malformed/);
});

test("repeated and cyclic cursors are rejected", async () => {
  await assert.rejects(collectBalancePages(reader([page([row(T1)], "c1"), page([row(T2)], "c1")]).read, CHAIN), /repeated/);
  await assert.rejects(
    collectBalancePages(reader([page([row(T1)], "a"), page([row(T2)], "b"), page([row(T3)], "a")]).read, CHAIN),
    /repeated/);
});

test("maxPages is validated and enforced while more pages remain", async () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(collectBalancePages(reader([]).read, CHAIN, bad), /maxPages/);
  }
  const r = reader([page([row(T1)], "c1"), page([row(T2)], "c2"), page([row(T3)])]);
  await assert.rejects(collectBalancePages(r.read, CHAIN, 2), /exceeded maxPages/);
  assert.equal(r.seen.length, 2);
  const ok = reader([page([row(T1)], "c1"), page([row(T2)])]);
  assert.equal((await collectBalancePages(ok.read, CHAIN, 2)).balances.length, 2);
});

test("known refreshed_at change between pages aborts", async () => {
  const r = reader([page([row(T1)], "c1", meta("2026-10-20T00:00:00Z")),
    page([row(T2)], undefined, meta("2026-10-20T06:00:00Z"))]);
  await assert.rejects(collectBalancePages(r.read, CHAIN), /snapshot changed/);
});

test("null freshness stays unknown and is not fabricated", async () => {
  const allNull = await collectBalancePages(
    reader([page([row(T1)], "c1", meta(null)), page([row(T2)], undefined, meta(null))]).read, CHAIN);
  assert.equal(allNull.refreshedAt, null);
  const A = "2026-10-20T00:00:00Z";
  const run = (stamps: (string | null)[]) =>
    collectBalancePages(reader(stamps.map((s, i) =>
      page([row("0x" + String(i + 1).repeat(40))], i < stamps.length - 1 ? `c${i}` : undefined, meta(s)))).read, CHAIN);
  const nt = await run([null, A]);
  assert.deepEqual(nt.pages.map((m) => m.refreshed_at), [null, A]);
  assert.equal(nt.refreshedAt, null);
  assert.equal((await run([A, null])).refreshedAt, null);
  assert.equal((await run([A, A])).refreshedAt, A);
  assert.equal((await run([null, null])).refreshedAt, null);
  await assert.rejects(run([A, null, "2026-10-20T06:00:00Z"]), /snapshot changed/);
});

test("duplicate tokens are rejected across pages (case-insensitive) and within a page", async () => {
  const upper = "0x" + "AB".repeat(20);
  const lower = "0x" + "ab".repeat(20);
  await assert.rejects(collectBalancePages(reader([page([row(upper)], "c1"), page([row(lower)])]).read, CHAIN), /duplicate/);
  await assert.rejects(collectBalancePages(reader([page([row(T1), row(T1)])]).read, CHAIN), /duplicate/);
});
