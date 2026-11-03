import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

// The alternate module is an explicit, local unsafe comparison, not a RED import failure.
const { createHeaderScopedRpcFetch } = await import(
  process.env.SCOPED_RPC_COMPARISON_MODULE ?? '../examples/header-scoped-rpc-fetch.mjs'
);
const endpoint = 'https://api.blockvectra.com/v1/eth_mainnet';
const apiKey = 'synthetic-only-not-a-real-key';

function capture(options = {}) {
  const calls = [];
  const response = new Response('unread response', { status: 200 });
  const fetcher = createHeaderScopedRpcFetch({ endpoint, apiKey, fetchImpl: async (input, init) => {
    calls.push({ input, init });
    return response;
  }, ...options });
  return { fetcher, calls, response };
}

test('exact endpoint gets the key and preserves request and response semantics', async () => {
  const { fetcher, calls, response } = capture();
  const controller = new AbortController();
  const body = new Uint8Array([1, 2, 3]);
  const headers = new Headers({ 'content-type': 'application/json', 'x-trace': 'trace' });
  const init = { method: 'POST', body, signal: controller.signal, headers, redirect: 'follow' };
  const result = await fetcher(endpoint, init);
  assert.equal(result, response, 'Return the original Response without consuming or wrapping it');
  assert.equal(response.bodyUsed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, endpoint);
  assert.equal(calls[0].init.headers.get('x-api-key'), apiKey);
  assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
  assert.equal(calls[0].init.headers.get('x-trace'), 'trace');
  assert.equal(calls[0].init.body, body);
  assert.equal(calls[0].init.signal, controller.signal);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error', 'Caller follow must never enable credential redirects');
  assert.equal(headers.has('x-api-key'), false, 'Do not mutate caller headers');
  assert.equal(init.redirect, 'follow');
});

const foreignInputs = [
  'https://fallback.example/rpc',
  'https://api.blockvectra.com/v1/robinhood_mainnet',
  `${endpoint}/public`, `${endpoint}/`, `${endpoint}?x=1`, `${endpoint}?`,
  `${endpoint}#fragment`, `${endpoint}#`, `${endpoint}/../eth_mainnet`,
  'https://api.blockvectra.com/v1/other/../eth_mainnet',
  'https://api.blockvectra.com/v1/%2e/eth_mainnet',
  'https://api.blockvectra.com/v1/%65th_mainnet',
  'https://api.blockvectra.com:443/v1/eth_mainnet',
  'https://API.BLOCKVECTRA.COM/v1/eth_mainnet',
  'https://api.blockvectra.com./v1/eth_mainnet',
  'https://api.blockvectra.com.evil.example/v1/eth_mainnet',
  'https://api.blockvectra.com@evil.example/v1/eth_mainnet',
  'https://user:pass@api.blockvectra.com/v1/eth_mainnet',
  'https://@api.blockvectra.com/v1/eth_mainnet',
  'http://api.blockvectra.com/v1/eth_mainnet',
  ' https://api.blockvectra.com/v1/eth_mainnet',
  `${endpoint}\n`, 'https://api.blockvectra.com/v1/eth_\tmainnet',
  'https://api.blockvectra.com\\v1\\eth_mainnet',
];
for (const input of foreignInputs) {
  test(`raw non-exact string gets no private key: ${JSON.stringify(input)}`, async () => {
    const { fetcher, calls } = capture();
    await fetcher(input, { headers: { 'x-trace': 'fallback' } });
    assert.equal(calls.length, 1, 'Foreign inputs still reach the injected transport');
    assert.equal(calls[0].input, input, 'Do not normalize or append URL parameters');
    assert.equal(calls[0].init.headers.get('x-api-key'), null, 'Private key must be scoped to the exact raw endpoint');
    assert.equal(calls[0].init.headers.get('x-trace'), 'fallback');
    assert.equal(calls[0].init.redirect, 'error');
  });
}

test('URL objects use their already-normalized serialization', async () => {
  const { fetcher, calls } = capture();
  const url = new URL('https://API.BLOCKVECTRA.COM:443/v1/other/../eth_mainnet');
  await fetcher(url);
  assert.equal(calls[0].input, url.href);
  assert.equal(calls[0].init.headers.get('x-api-key'), apiKey);
  await fetcher(new URL(`${endpoint}/public`));
  assert.equal(calls[1].init.headers.get('x-api-key'), null);
});

test('both example slugs are explicit choices, with no chain default', async () => {
  const chosen = 'https://api.blockvectra.com/v1/robinhood_mainnet';
  const { fetcher, calls } = capture({ endpoint: chosen });
  await fetcher(chosen);
  await fetcher(endpoint);
  assert.equal(calls[0].init.headers.get('x-api-key'), apiKey);
  assert.equal(calls[1].init.headers.get('x-api-key'), null);
});

const invalidEndpoints = [undefined, null, 1, new URL(endpoint), '',
  ...foreignInputs.filter((value) => value !== 'https://api.blockvectra.com/v1/robinhood_mainnet'),
  'https://api.blockvectra.com/v1/public', `${endpoint}_public`,
  'https://api.blockvectra.com/v1/', 'https://api.blockvectra.com/v1/eth%2fmainnet',
];
for (const invalid of invalidEndpoints) {
  test(`invalid endpoint rejected before requests: ${JSON.stringify(invalid)}`, () => {
    let calls = 0;
    assert.throws(() => createHeaderScopedRpcFetch({ endpoint: invalid, apiKey, fetchImpl: () => { calls++; } }),
      { name: 'TypeError', message: 'Invalid RPC endpoint.' });
    assert.equal(calls, 0);
  });
}
for (const invalid of [undefined, null, 42, '', ' ', '\t', 'synthetic\r\nsecret', 'synthetic\0secret', 'synthetic\x7fsecret', 'synthetic\u0100secret', ' synthetic', 'synthetic ']) {
  test(`unsafe key rejected at construction: ${JSON.stringify(invalid)}`, () => {
    let calls = 0;
    assert.throws(() => createHeaderScopedRpcFetch({ endpoint, apiKey: invalid, fetchImpl: () => { calls++; } }),
      { name: 'TypeError', message: 'Invalid RPC API key.' });
    assert.equal(calls, 0);
  });
}

test('missing configuration and transport fail with fixed errors', () => {
  assert.throws(() => createHeaderScopedRpcFetch(), { name: 'TypeError', message: 'Invalid RPC endpoint.' });
  assert.throws(() => createHeaderScopedRpcFetch({ endpoint, apiKey, fetchImpl: null }),
    { name: 'TypeError', message: 'Invalid RPC fetch implementation.' });
});

for (const name of ['X-API-KEY', 'x-aPi-kEy', 'Authorization', 'aUtHoRiZaTiOn']) {
  for (const [form, makeHeaders] of [
    ['Headers', () => new Headers([[name, 'synthetic-caller-credential']])],
    ['tuples', () => [['x-trace', 'ok'], [name, 'synthetic-caller-credential']]],
    ['object', () => ({ 'x-trace': 'ok', [name]: 'synthetic-caller-credential' })],
  ]) {
    test(`reject caller credential ${name} in ${form} on primary and fallback`, async () => {
      const { fetcher, calls } = capture();
      for (const url of [endpoint, 'https://fallback.example/rpc']) {
        await assert.rejects(fetcher(url, { headers: makeHeaders() }),
          { name: 'TypeError', message: 'Caller credential headers are not allowed.' });
      }
      assert.equal(calls.length, 0, 'Reject before any request, including fallback');
    });
  }
}
for (const [form, headers] of [
  ['Headers', new Headers({ 'content-type': 'application/json' })],
  ['tuples', [['content-type', 'application/json']]],
  ['object', { 'content-type': 'application/json' }],
]) {
  test(`ordinary ${form} headers survive without caller mutation`, async () => {
    const before = [...new Headers(headers)];
    const { fetcher, calls } = capture();
    await fetcher(endpoint, { headers });
    assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    assert.equal(calls[0].init.headers.get('x-api-key'), apiKey);
    assert.deepEqual([...new Headers(headers)], before);
  });
}

test('reject Request and other non-string/non-URL inputs before transport', async () => {
  const { fetcher, calls } = capture();
  for (const input of [new Request(endpoint), {}, { toString: () => endpoint }, null, 1]) {
    await assert.rejects(fetcher(input), { name: 'TypeError', message: 'RPC input must be a string or URL; Request is not supported.' });
  }
  assert.equal(calls.length, 0);
});

test('429 and transport failures return unchanged without retry or body reads', async () => {
  const response = new Response('unread rate limit', { status: 429 });
  let calls = 0;
  const failure = new Error('synthetic transport failure');
  const fetcher = createHeaderScopedRpcFetch({ endpoint, apiKey, fetchImpl: async () => {
    calls++;
    if (calls === 1) return response;
    throw failure;
  } });
  assert.equal(await fetcher(endpoint), response);
  assert.equal(response.bodyUsed, false);
  assert.equal(calls, 1, '429 must not trigger an automatic retry');
  await assert.rejects(fetcher(endpoint), (error) => error === failure);
  assert.equal(calls, 2, 'Transport errors must not trigger an automatic retry');
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('local HTTP fixture blocks credential redirect second hops and preserves fallback POST', async () => {
  const firstHops = [];
  const secondHops = [];
  const fallbackCalls = [];
  const sink = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const record = { url: req.url, method: req.method, headers: req.headers, body };
    (req.url === '/fallback' ? fallbackCalls : secondHops).push(record);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('local fixture response');
  });
  let sinkOrigin;
  const primary = createServer((req, res) => {
    firstHops.push({ headers: req.headers, url: req.url });
    res.writeHead(307, { location: `${sinkOrigin}/second-hop` });
    res.end();
  });
  try {
    sinkOrigin = await listen(sink);
    const primaryOrigin = await listen(primary);
    // Mapping is test-only: no production DNS/TLS or business HTTP/RPC is exercised.
    const mappedFetch = (input, init) => {
      const target = String(input);
      assert.ok(target === endpoint || target === `${sinkOrigin}/fallback`, 'Only loopback destinations are permitted by this fixture');
      return fetch(target === endpoint ? `${primaryOrigin}/redirect` : target, init);
    };
    const fetcher = createHeaderScopedRpcFetch({ endpoint, apiKey, fetchImpl: mappedFetch });
    await assert.rejects(fetcher(endpoint, { redirect: 'follow' }),
      { name: 'TypeError' }, 'A real HTTP redirect must fail instead of forwarding the synthetic key');
    assert.equal(firstHops.length, 1, 'Anchor the test on a real first-hop request');
    assert.equal(firstHops[0].headers['x-api-key'], apiKey);
    assert.equal(secondHops.length, 0, 'No second hop may receive the synthetic key');
    const defaultFetcher = createHeaderScopedRpcFetch({ endpoint, apiKey });
    const response = await defaultFetcher(`${sinkOrigin}/fallback`, {
      method: 'POST', headers: { 'content-type': 'text/plain', 'x-trace': 'fixture-trace' }, body: 'fixture payload',
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'local fixture response');
    assert.equal(fallbackCalls.length, 1);
    assert.equal(fallbackCalls[0].method, 'POST');
    assert.equal(fallbackCalls[0].headers['x-trace'], 'fixture-trace');
    assert.equal(fallbackCalls[0].headers['content-type'], 'text/plain');
    assert.equal(fallbackCalls[0].body, 'fixture payload');
    assert.equal(fallbackCalls[0].headers['x-api-key'], undefined);
    console.log('RESULT: loopback redirect blocked; second-hop=0; fallback POST/header/body preserved');
  } finally {
    await Promise.all([close(primary), close(sink)]);
  }
});


test('URL serialization is snapshotted before transport, ignoring overridden conversion', async () => {
  class RedirectingURL extends URL {
    toString() { return 'https://fallback.example/rpc'; }
    get href() { return 'https://fallback.example/rpc'; }
  }
  const { fetcher, calls } = capture();
  await fetcher(new RedirectingURL(endpoint));
  assert.equal(calls[0].input, endpoint, 'Transport must receive the same URL serialization used for authorization');
  assert.equal(calls[0].init.headers.get('x-api-key'), apiKey);
});

test('malformed headers reject with a fixed error without reflecting values', async () => {
  const { fetcher, calls } = capture();
  await assert.rejects(fetcher(endpoint, { headers: { 'x-trace': 'synthetic-secret\r\ninvalid' } }),
    { name: 'TypeError', message: 'Invalid RPC headers.' });
  assert.equal(calls.length, 0);
});

test('empty and duplicate caller credential headers are still rejected', async () => {
  const { fetcher, calls } = capture();
  for (const headers of [{ Authorization: '' }, [['X-API-Key', ''], ['x-api-key', 'synthetic-caller']]]) {
    await assert.rejects(fetcher(endpoint, { headers }),
      { name: 'TypeError', message: 'Caller credential headers are not allowed.' });
  }
  assert.equal(calls.length, 0);
});
