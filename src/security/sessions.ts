import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Opaque random tokens; only a hash is stored, so a DB leak does not yield usable sessions. */
export class Sessions {
  constructor(private pool: Pool, private ttlMs = 12 * 3600_000) {}

  async create(accountId: string, device?: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.pool.query(
      "INSERT INTO sessions(account_id, token_hash, expires_at, device) VALUES ($1,$2,now() + ($3 || ' milliseconds')::interval,$4)",
      [accountId, sha(token), String(this.ttlMs), device ?? null],
    );
    return token;
  }

  /** Returns the account id, or undefined if unknown, expired or revoked. */
  async verify(token: string): Promise<string | undefined> {
    const r = await this.pool.query(
      "SELECT account_id FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()",
      [sha(token)],
    );
    return r.rows[0]?.account_id;
  }

  async revoke(token: string) {
    await this.pool.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [sha(token)]);
  }

  async revokeAll(accountId: string) {
    await this.pool.query("UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL", [accountId]);
  }
}
