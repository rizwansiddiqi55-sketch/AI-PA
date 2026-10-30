import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM. Layout: iv(12) | tag(16) | ciphertext. Key: 32 bytes, base64 in TOKEN_ENCRYPTION_KEY. */
export function loadKey(b64 = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  const key = Buffer.from(b64 ?? "", "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encrypt(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer, key: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}
