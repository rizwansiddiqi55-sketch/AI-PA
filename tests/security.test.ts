import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/security/crypto";
import { randomBytes } from "node:crypto";

describe("token encryption", () => {
  const key = randomBytes(32);
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("refresh-token", key), b = encrypt("refresh-token", key);
    expect(decrypt(a, key)).toBe("refresh-token");
    expect(a.equals(b)).toBe(false);
  });
  it("rejects tampering and wrong keys", () => {
    const blob = encrypt("secret", key);
    blob[blob.length - 1]! ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });
});
