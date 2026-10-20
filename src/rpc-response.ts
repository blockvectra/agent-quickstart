export type QuantityResponse =
  | { kind: "success"; quantity: string }
  | { kind: "retryable-error" }
  | { kind: "invalid" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Classify a QUANTITY response to this example's numeric request ID 1. */
export function classifyQuantityResponse(httpOk: boolean, body: unknown): QuantityResponse {
  if (!isObject(body) || body.jsonrpc !== "2.0") return { kind: "invalid" };

  if (!has(body, "error")) {
    if (httpOk && body.id === 1 && has(body, "result") && typeof body.result === "string" &&
      /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(body.result)) {
      return { kind: "success", quantity: body.result };
    }
    return { kind: "invalid" };
  }

  // Admission can reject the entire request before reading its ID.
  if ((body.id === 1 || body.id === null) && !has(body, "result") && isObject(body.error) &&
    Number.isInteger(body.error.code) && typeof body.error.message === "string" &&
    isObject(body.error.data) && body.error.data.retryable === true) {
    return { kind: "retryable-error" };
  }
  return { kind: "invalid" };
}
