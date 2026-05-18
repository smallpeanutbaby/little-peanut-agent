import { safeStorage } from "electron";

/**
 * Stored ciphertext format: "enc:v1:<base64>". Plain text values (legacy,
 * unencrypted) are returned as-is. On systems where safeStorage is
 * unavailable, values are persisted as-is and a warning is logged.
 */
const PREFIX = "enc:v1:";

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[secret-store] safeStorage not available, persisting in plaintext");
    }
    return plain;
  }
  const buf = safeStorage.encryptString(plain);
  return PREFIX + buf.toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  if (!safeStorage.isEncryptionAvailable()) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[secret-store] safeStorage missing — cannot decrypt previously encrypted secret");
    }
    return "";
  }
  try {
    const b64 = stored.slice(PREFIX.length);
    const buf = Buffer.from(b64, "base64");
    return safeStorage.decryptString(buf);
  } catch {
    return "";
  }
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
