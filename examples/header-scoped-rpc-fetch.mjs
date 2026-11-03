/**
 * Server-side fetch adapter for one explicitly chosen private RPC endpoint.
 * String inputs match verbatim; URL objects match their normalized href.
 * Inject only a trusted fetch implementation that honors redirect: 'error'.
 */
export function createHeaderScopedRpcFetch({ endpoint, apiKey, fetchImpl = globalThis.fetch } = {}) {
  // Validate raw configuration rather than normalizing away credentials, ports,
  // dot segments, query strings, fragments, or a public endpoint suffix.
  if (typeof endpoint !== 'string'
    || !/^https:\/\/api\.blockvectra\.com\/v1\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(endpoint)
    || /(?:\/|_|-)public$/.test(endpoint)) {
    throw new TypeError('Invalid RPC endpoint.');
  }
  // A conservative HTTP header value: printable ASCII, no surrounding whitespace.
  if (typeof apiKey !== 'string' || !/^[\x20-\x7e]+$/.test(apiKey) || apiKey.trim() !== apiKey) {
    throw new TypeError('Invalid RPC API key.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid RPC fetch implementation.');
  }

  return async function fetcher(input, init = {}) {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new TypeError('RPC input must be a string or URL; Request is not supported.');
    }
    let headers;
    try {
      headers = new Headers(init.headers);
    } catch {
      throw new TypeError('Invalid RPC headers.');
    }
    if (headers.has('x-api-key') || headers.has('authorization')) {
      throw new TypeError('Caller credential headers are not allowed.');
    }
    const target = typeof input === 'string' ? input : URL.prototype.toString.call(input);
    if (target === endpoint) headers.set('x-api-key', apiKey);
    return fetchImpl(target, { ...init, headers, redirect: 'error' });
  };
}
