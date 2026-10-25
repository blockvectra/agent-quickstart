import { readPublicHead } from "./public-read.js";

const PUBLIC_READ_FAILED = "Public read failed: could not read the Robinhood mainnet head.";

async function main(): Promise<void> {
  const internalQa = process.env.BLOCKVECTRA_INTERNAL_QA === "1";
  try {
    const result = await readPublicHead(globalThis.fetch, internalQa);
    console.log(JSON.stringify(result));
  } catch {
    console.error(PUBLIC_READ_FAILED);
    process.exitCode = 1;
  }
}

void main();
