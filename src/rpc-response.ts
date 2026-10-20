export type BlockNumberResponse =
  | { kind: "success"; blockNumber: string }
  | { kind: "retryable-error" }
  | { kind: "invalid" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Classify the response to this example's numeric request ID 1, not arbitrary RPC methods. */
export function classifyBlockNumberResponse(httpOk: boolean, body: unknown): BlockNumberResponse {
  if (!isObject(body) || body.jsonrpc !== "2.0" || body.id !== 1) return { kind: "invalid" };

  if (!has(body, "error")) {
    if (httpOk && has(body, "result") && typeof body.result === "string" &&
      /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(body.result)) {
      return { kind: "success", blockNumber: body.result };
    }
    return { kind: "invalid" };
  }

  if (!has(body, "result") && isObject(body.error) &&
    Number.isInteger(body.error.code) && typeof body.error.message === "string" &&
    isObject(body.error.data) && body.error.data.retryable === true) {
    return { kind: "retryable-error" };
  }
  return { kind: "invalid" };
}
