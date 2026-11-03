import fs from "node:fs";

export type SavedApiKey = { api_key: string; key_id: string; wallet_address: string };
const INVALID = "Invalid saved API key. Preserve .agent-key.json and restore a trusted copy or use BLOCKVECTRA_API_KEY.";

function validKey(value: unknown): value is SavedApiKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.api_key === "string" && v.api_key.length > 0 && v.api_key.length <= 4096 && /^[\x21-\x7e]+$/.test(v.api_key) &&
    typeof v.key_id === "string" && v.key_id.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(v.key_id) &&
    typeof v.wallet_address === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.wallet_address);
}

export function parseCreatedApiKey(value: unknown, walletAddress: string): SavedApiKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid created API key response.");
  }
  const response = value as Record<string, unknown>;
  const key = response.key;
  const candidate = {
    api_key: response.api_key,
    key_id: typeof key === "object" && key !== null ? (key as Record<string, unknown>).key_id : undefined,
    wallet_address: walletAddress,
  };
  if (!validKey(candidate)) throw new Error("Invalid created API key response.");
  return candidate;
}

export function readSavedApiKey(file: string, walletAddress: string): SavedApiKey | undefined {
  let fd: number;
  try {
    // lstat also rejects links on platforms without O_NOFOLLOW.
    if (!fs.lstatSync(file).isFile()) throw new Error(INVALID);
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(INVALID);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 16_384 ||
      (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
      throw new Error(INVALID);
    }
    const data: unknown = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!validKey(data) || data.wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error(INVALID);
    }
    return data;
  } catch {
    throw new Error(INVALID);
  } finally {
    fs.closeSync(fd);
  }
}

/** Exclusive create never overwrites an existing credential, including a damaged one. */
export function saveApiKey(file: string, key: SavedApiKey): void {
  if (!validKey(key)) throw new Error("Invalid created API key response.");
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, JSON.stringify(key) + "\n");
    fs.fsyncSync(fd);
  } catch {
    throw new Error("Cannot save .agent-key.json. Preserve existing files and check access before retrying.");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
