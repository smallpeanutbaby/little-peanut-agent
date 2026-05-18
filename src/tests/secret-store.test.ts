import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real `secret-store` imports `electron`'s `safeStorage`. In a Node test
 * environment that module doesn't exist, so we mock it. We expose a knob to
 * flip `isEncryptionAvailable` on/off, which is the exact code path we care
 * about (graceful fallback to plaintext when the platform can't encrypt).
 */
const mockState = { available: true };

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.available,
    // The real method returns a Buffer; we keep it byte-for-byte reversible
    // by simply prefixing the plain string with a tag and base64-encoding.
    encryptString: (plain: string) => Buffer.from("MOCK:" + plain, "utf8"),
    decryptString: (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("MOCK:")) throw new Error("not a mocked ciphertext");
      return s.slice(5);
    }
  }
}));

// Important: import AFTER vi.mock so the mock is picked up.
const { encryptSecret, decryptSecret, isEncrypted } = await import("../main/security/secret-store");

describe("secret-store", () => {
  beforeEach(() => {
    mockState.available = true;
  });
  afterEach(() => {
    mockState.available = true;
  });

  describe("encryptSecret", () => {
    it("returns '' for an empty plaintext (no-op)", () => {
      expect(encryptSecret("")).toBe("");
    });

    it("returns a prefixed base64 payload when safeStorage is available", () => {
      const out = encryptSecret("sk-abc");
      expect(out.startsWith("enc:v1:")).toBe(true);
      expect(out.length).toBeGreaterThan("enc:v1:".length);
    });

    it("falls back to plaintext (without prefix) when safeStorage is unavailable", () => {
      mockState.available = false;
      const out = encryptSecret("sk-abc");
      expect(out).toBe("sk-abc");
    });
  });

  describe("decryptSecret", () => {
    it("returns '' for null/undefined/empty input", () => {
      expect(decryptSecret(null)).toBe("");
      expect(decryptSecret(undefined)).toBe("");
      expect(decryptSecret("")).toBe("");
    });

    it("passes through legacy plaintext values unchanged", () => {
      expect(decryptSecret("sk-legacy-plaintext")).toBe("sk-legacy-plaintext");
    });

    it("round-trips an encrypted value back to the original plaintext", () => {
      const out = encryptSecret("sk-roundtrip");
      expect(decryptSecret(out)).toBe("sk-roundtrip");
    });

    it("returns '' if safeStorage is missing when we have a previously-encrypted value", () => {
      const cipher = encryptSecret("sk-frozen");
      mockState.available = false;
      // We can't decrypt without the underlying key; surface a safe empty
      // string rather than the raw ciphertext (which would leak the prefix).
      expect(decryptSecret(cipher)).toBe("");
    });
  });

  describe("isEncrypted", () => {
    it("returns true only for values that start with the v1 prefix", () => {
      expect(isEncrypted("enc:v1:abcdef==")).toBe(true);
      expect(isEncrypted("sk-plain")).toBe(false);
      expect(isEncrypted("")).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });
  });
});
