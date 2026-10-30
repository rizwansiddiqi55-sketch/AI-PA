import type { Pool } from "pg";
import { decrypt, encrypt } from "../../security/crypto";
import { OAuthError, refreshTokens, type TokenSet } from "./oauth";
import { clientCreds, providerConfig, type ProviderId } from "./providers";

export interface IntegrationRow { id: string; provider: ProviderId; externalId: string; status: string; scopes: string[] }

/** Encrypted OAuth token storage in the `integrations` table. Tokens never leave the server. */
export class TokenVault {
  constructor(private pool: Pool, private key: Buffer, private f: typeof fetch = fetch, private now: () => number = Date.now) {}

  async save(accountId: string, provider: ProviderId, externalId: string, scopes: string[], t: TokenSet): Promise<string> {
    const r = await this.pool.query(
      `INSERT INTO integrations(account_id, provider, external_id, scopes, token_cipher, status)
       VALUES ($1,$2,$3,$4,$5,'connected')
       ON CONFLICT (account_id, provider, external_id)
       DO UPDATE SET token_cipher=EXCLUDED.token_cipher, scopes=EXCLUDED.scopes, status='connected', connected_at=now()
       RETURNING id`,
      [accountId, provider, externalId, scopes, encrypt(JSON.stringify(t), this.key)],
    );
    return r.rows[0].id;
  }

  async list(accountId: string): Promise<IntegrationRow[]> {
    const r = await this.pool.query("SELECT id, provider, external_id, status, scopes FROM integrations WHERE account_id=$1 ORDER BY connected_at", [accountId]);
    return r.rows.map((x) => ({ id: x.id, provider: x.provider, externalId: x.external_id, status: x.status, scopes: x.scopes }));
  }

  /** Returns a valid access token, refreshing (and persisting) when it is about to expire. */
  async getAccessToken(accountId: string, integrationId: string): Promise<string> {
    const r = await this.pool.query("SELECT provider, token_cipher, status FROM integrations WHERE id=$1 AND account_id=$2", [integrationId, accountId]);
    const row = r.rows[0];
    if (!row || row.status !== "connected") throw new Error("integration is not connected");
    const provider = row.provider as ProviderId;
    const t = JSON.parse(decrypt(row.token_cipher, this.key)) as TokenSet;
    if (t.expiresAt - 60_000 > this.now()) return t.accessToken;
    if (!t.refreshToken) { await this.mark(integrationId, "error"); throw new Error("no refresh token; reconnect the account"); }
    try {
      const fresh = await refreshTokens(providerConfig(provider), { ...clientCreds(provider), refreshToken: t.refreshToken }, this.f, this.now());
      // Microsoft rotates refresh tokens; Google keeps the old one. Never lose the working one.
      const merged: TokenSet = { ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken };
      await this.pool.query("UPDATE integrations SET token_cipher=$2 WHERE id=$1", [integrationId, encrypt(JSON.stringify(merged), this.key)]);
      return merged.accessToken;
    } catch (e) {
      if (e instanceof OAuthError && e.code === "invalid_grant") await this.mark(integrationId, "error");
      throw e;
    }
  }

  /** Disconnect: revoke at Google when possible, then wipe our copy of the tokens. */
  async disconnect(accountId: string, integrationId: string): Promise<void> {
    const r = await this.pool.query("SELECT provider, token_cipher FROM integrations WHERE id=$1 AND account_id=$2", [integrationId, accountId]);
    const row = r.rows[0];
    if (!row) throw new Error("not found");
    const cfg = providerConfig(row.provider);
    if (cfg.revokeUrl && row.token_cipher.length > 0) {
      try {
        const t = JSON.parse(decrypt(row.token_cipher, this.key)) as TokenSet;
        await this.f(`${cfg.revokeUrl}?token=${encodeURIComponent(t.refreshToken ?? t.accessToken)}`, { method: "POST" });
      } catch { /* best effort; local wipe below is what matters */ }
    }
    await this.pool.query("UPDATE integrations SET status='revoked', token_cipher='\\x'::bytea WHERE id=$1", [integrationId]);
  }

  private async mark(id: string, status: "error" | "revoked") {
    await this.pool.query("UPDATE integrations SET status=$2 WHERE id=$1", [id, status]);
  }
}
