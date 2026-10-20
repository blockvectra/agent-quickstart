export const ROBINHOOD_MAINNET_ID = 4663;

/** Select this example's network by its exact slug and numeric chain ID. */
export function selectRobinhoodMainnet(directory: unknown) {
  if (typeof directory !== "object" || directory === null ||
    !("chains" in directory) || !Array.isArray(directory.chains)) {
    throw new Error("Invalid chain directory");
  }
  const matches = directory.chains.filter((entry: unknown): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) &&
    "chain" in entry && entry.chain === "robinhood_mainnet");
  if (matches.length !== 1 || matches[0].chain_id !== ROBINHOOD_MAINNET_ID) {
    throw new Error("Chain directory must contain exactly one Robinhood mainnet entry with chain ID 4663");
  }
  return {
    chain: "robinhood_mainnet",
    chain_id: ROBINHOOD_MAINNET_ID,
    name: typeof matches[0].name === "string" ? matches[0].name : "Robinhood Chain",
  };
}
