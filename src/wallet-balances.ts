// Read-only consumer for GET /{chain}/addresses/{address}/balances envelopes.
// Contract: data.yaml sha256 c5b949e955b5efd70e221b0dc91d5cd2502332534ee907aca2c48dd2457ca36d
// (AddressBalance, AddressBalanceListEnvelope, Meta, UInt256String). Only the fields
// below are checked; other Meta properties are passed through untouched.

export interface AddressBalance {
  token: string;
  /** Raw decimal-integer string; never converted to Number. */
  balance: string;
  symbol: string | null;
  /** Integer 0..255 or null (unknown). 0 is a real value, distinct from null. */
  decimals: number | null;
}

export interface BalanceMeta {
  chain: string;
  /** Snapshot time, or null when unknown (stale). Not tied to as_of_block. */
  refreshed_at: string | null;
  [key: string]: unknown;
}

export interface BalancePage {
  data: AddressBalance[];
  meta: BalanceMeta;
  next_cursor?: string;
}

export interface CollectedBalances {
  balances: AddressBalance[];
  /** Original meta of every page, in fetch order. */
  pages: BalanceMeta[];
  /** The single known refreshed_at seen across pages, or null if all were unknown. */
  refreshedAt: string | null;
}

export type ReadPage = (cursor?: string) => Promise<unknown>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^[0-9]+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeRow(row: unknown, index: number): AddressBalance {
  if (!isRecord(row)) throw new Error(`malformed balance row ${index}: not an object`);
  const { token, balance, symbol, decimals } = row;
  if (typeof token !== "string" || !ADDRESS.test(token)) {
    throw new Error(`malformed balance row ${index}: invalid token address`);
  }
  if (typeof balance !== "string" || !UINT.test(balance)) {
    throw new Error(`malformed balance row ${index}: balance must be a decimal integer string`);
  }
  if (!Object.hasOwn(row, "symbol") || (symbol !== null && typeof symbol !== "string")) {
    throw new Error(`malformed balance row ${index}: symbol must be string or null`);
  }
  if (
    !Object.hasOwn(row, "decimals") ||
    (decimals !== null &&
      !(typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255))
  ) {
    throw new Error(`malformed balance row ${index}: decimals must be integer 0..255 or null`);
  }
  return { token, balance, symbol, decimals };
}

export function decodeBalancePage(raw: unknown, expectedChain: string): BalancePage {
  if (!isRecord(raw)) throw new Error("malformed balances response: not an object");
  const { data, meta, next_cursor } = raw;
  if (!Array.isArray(data)) throw new Error("malformed balances response: data must be an array");
  if (!isRecord(meta)) throw new Error("malformed balances response: meta must be an object");
  if (meta.chain !== expectedChain) {
    throw new Error(`balances chain mismatch: expected ${expectedChain}, got ${String(meta.chain)}`);
  }
  if (!Object.hasOwn(meta, "refreshed_at") || (meta.refreshed_at !== null && typeof meta.refreshed_at !== "string")) {
    throw new Error("malformed balances response: meta.refreshed_at must be string or null");
  }
  if (Object.hasOwn(raw, "next_cursor") && typeof next_cursor !== "string") {
    throw new Error("malformed balances response: next_cursor must be a string when present");
  }
  const page: BalancePage = { data: data.map(decodeRow), meta: meta as BalanceMeta };
  if (typeof next_cursor === "string") page.next_cursor = next_cursor;
  return page;
}

export async function collectBalancePages(
  readPage: ReadPage,
  expectedChain: string,
  maxPages = 20,
): Promise<CollectedBalances> {
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error("maxPages must be a positive safe integer");
  }
  const balances: AddressBalance[] = [];
  const pages: BalanceMeta[] = [];
  const tokens = new Set<string>();
  const cursors = new Set<string>();
  let refreshedAt: string | null = null;
  let cursor: string | undefined;

  for (let n = 1; ; n++) {
    const page = decodeBalancePage(await readPage(cursor), expectedChain);
    const stamp = page.meta.refreshed_at;
    if (stamp !== null) {
      if (refreshedAt !== null && refreshedAt !== stamp) {
        throw new Error(`balances snapshot changed between pages: ${refreshedAt} -> ${stamp}`);
      }
      refreshedAt = stamp;
    }
    for (const row of page.data) {
      const key = row.token.toLowerCase();
      if (tokens.has(key)) throw new Error(`duplicate token across balance pages: ${row.token}`);
      tokens.add(key);
      balances.push(row);
    }
    pages.push(page.meta);
    if (page.next_cursor === undefined) return { balances, pages, refreshedAt };
    if (cursors.has(page.next_cursor)) throw new Error("balances pagination cursor repeated");
    if (n >= maxPages) throw new Error(`balances pagination exceeded maxPages (${maxPages})`);
    cursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}
