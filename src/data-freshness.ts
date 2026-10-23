export interface FreshnessDataset {
  dataset: string;
  max_block_number: number | null;
  seconds_behind: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeDataset(value: unknown, status: number): FreshnessDataset {
  if (!isRecord(value)) {
    throw new Error(`Data API response malformed (HTTP ${status}): dataset row must be an object`);
  }
  const { dataset, max_block_number, seconds_behind } = value;
  if (typeof dataset !== "string") {
    throw new Error(`Data API response malformed (HTTP ${status}): dataset must be a string`);
  }
  if (max_block_number !== null &&
    (typeof max_block_number !== "number" || !Number.isInteger(max_block_number))) {
    throw new Error(`Data API response malformed (HTTP ${status}): max_block_number must be an integer or null`);
  }
  if (seconds_behind !== null &&
    (typeof seconds_behind !== "number" || !Number.isInteger(seconds_behind))) {
    throw new Error(`Data API response malformed (HTTP ${status}): seconds_behind must be an integer or null`);
  }
  return { dataset, max_block_number, seconds_behind };
}

/** Validate and decode the subset of the freshness response consumed by the quickstart. */
export async function readFreshness(response: Response, expectedChain: string): Promise<FreshnessDataset[]> {
  if (!response.ok) {
    throw new Error(`Data API request failed (HTTP ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Data API response was not valid JSON (HTTP ${response.status})`);
  }

  if (!isRecord(payload)) {
    throw new Error(`Data API response malformed (HTTP ${response.status}): envelope must be an object`);
  }
  const { meta, data } = payload;
  if (!isRecord(meta)) {
    throw new Error(`Data API response malformed (HTTP ${response.status}): meta must be an object`);
  }
  if (meta.chain !== expectedChain) {
    throw new Error(`Data API response chain mismatch (HTTP ${response.status})`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`Data API response malformed (HTTP ${response.status}): data must be an array`);
  }

  return data.map((row) => decodeDataset(row, response.status));
}
