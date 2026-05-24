import { createHash } from "node:crypto";

const CHROME_EXTENSION_ID_ALPHABET = "abcdefghijklmnop";

export const EXPECTED_DEVELOPMENT_EXTENSION_ID = "mahnogfphkjigcjomjcjifkfdnocbokh";

export function deriveChromeExtensionId(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.trim().length === 0) {
    throw new Error("Chrome extension public key is required");
  }
  if (publicKeyBase64.trim() !== publicKeyBase64 || !isCanonicalBase64(publicKeyBase64)) {
    throw new Error("Chrome extension public key must be valid base64");
  }

  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
  if (publicKeyBytes.length === 0) {
    throw new Error("Chrome extension public key must be valid base64");
  }

  const digest = createHash("sha256").update(publicKeyBytes).digest();
  let extensionId = "";

  for (const byte of digest.subarray(0, 16)) {
    extensionId += CHROME_EXTENSION_ID_ALPHABET[byte >> 4];
    extensionId += CHROME_EXTENSION_ID_ALPHABET[byte & 0x0f];
  }

  return extensionId;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;

  const firstPaddingIndex = value.indexOf("=");
  if (firstPaddingIndex !== -1 && !/^=+$/.test(value.slice(firstPaddingIndex))) return false;

  return Buffer.from(value, "base64").toString("base64") === value;
}
