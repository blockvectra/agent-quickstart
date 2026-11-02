import { readPublicHead } from "./public-read.ts";
import { formatPublicReadFailure } from "./public-read-errors.ts";

async function main(): Promise<void> {
  const internalQa = process.env.BLOCKVECTRA_INTERNAL_QA === "1";
  try {
    const result = await readPublicHead(globalThis.fetch, internalQa);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(formatPublicReadFailure(error));
    process.exitCode = 1;
  }
}

void main();
