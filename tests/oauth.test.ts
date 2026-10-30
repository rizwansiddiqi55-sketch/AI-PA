import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { completeConnect, startConnect } from "../src/integrations/oauth/connect";
import { buildAuthUrl, exchangeCode, fetchIdentity, newPkce, statesMatch } from "../src/integrations/oauth/oauth";
import { providerConfig } from "../src/integrations/oauth/providers";
import { TokenVault } from "../src/integrations/oauth/vault";
import { rateLimited, secretMatches } from "../src/lib/server";

process.env.GOOGLE_CLIENT_ID = "gid"; process.env.GOOGLE_CLIENT_SECRET = "gsec";
process.env.MICROSOFT_CLIENT_ID = "mid"; process.env.MICROSOFT_CLIENT_SECRET = "msec";

describe("auth URLs", () => {
  it("PKCE challenge is the S256 of the verifier", () => {
    const p = newPkce();
    expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
  });
  it("Google: offline access + consent, gmail scopes, no send-everything scope", () => {
    const u = new URL(startConnect("google", "http://x/cb").url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("gmail.compose");
    expect(u.searchParams.get("scope")).not.toContain("mail.google.com");
  });
  it("Microsoft: personal-account capable tenant, offline_access + Mail scopes", () => {
    const u = new URL(startConnect("microsoft", "http://x/cb").url);
    expect(u.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("scope")).toContain("Mail.Send");
    expect(providerConfig("microsoft", { MICROSOFT_TENANT: "consumers" }).authUrl).toContain("/consumers/");
  });
  it("state comparison", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
  });
});

describe("token endpoints (fake HTTP)", () => {
  it("exchange sends the PKCE verifier and parses tokens", async () => {
    let body = "";
    const f = (async (_u: string, init?: RequestInit) => { body = String(init?.body); return new Response(JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 3600 })); }) as typeof fetch;
    const t = await exchangeCode(providerConfig("google"), { clientId: "c", clientSecret: "s", redirectUri: "http://x/cb", code: "CODE", verifier: "VER" }, f, 1000);
    expect(new URLSearchParams(body).get("code_verifier")).toBe("VER");
    expect(t).toEqual({ accessToken: "A", refreshToken: "R", expiresAt: 1000 + 3600_000 });
  });
  it("identity: Google email, Microsoft mail falling back to userPrincipalName", async () => {
    const mk = (j: object) => (async () => new Response(JSON.stringify(j))) as unknown as typeof fetch;
    expect(await fetchIdentity(providerConfig("google"), "t", mk({ email: "Me@Gmail.com" }))).toBe("me@gmail.com");
    expect(await fetchIdentity(providerConfig("microsoft"), "t", mk({ mail: null, userPrincipalName: "me@live.com" }))).toBe("me@live.com");
  });
});

describe("app auth helpers", () => {
  it("bootstrap secret: constant-time, min length", () => {
    const s = randomBytes(24).toString("hex");
    expect(secretMatches(s, s)).toBe(true);
    expect(secretMatches("x", s)).toBe(false);
    expect(secretMatches("short", "short")).toBe(false);
  });
  it("rate limiter blocks after the limit and resets", () => {
    for (let i = 0; i < 5; i++) expect(rateLimited("k", 5, 1000, 0)).toBe(false);
    expect(rateLimited("k", 5, 1000, 10)).toBe(true);
    expect(rateLimited("k", 5, 1000, 2000)).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("connect + vault on real Postgres", () => {
  let pool: Pool, accountId: string;
  const key = randomBytes(32);
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    accountId = (await pool.query("INSERT INTO accounts(email) VALUES ($1) RETURNING id", [`o${Date.now()}@example.com`])).rows[0].id;
  });
  afterAll(async () => { await pool.query("DELETE FROM accounts WHERE id=$1", [accountId]); await pool.end(); });

  const fakeProvider = (calls: string[] = []) => (async (u: string, init?: RequestInit) => {
    calls.push(u);
    if (u.includes("/token")) {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      return new Response(JSON.stringify(grant === "refresh_token"
        ? { access_token: "A2", refresh_token: "R2", expires_in: 3600 }
        : { access_token: "A1", refresh_token: "R1", expires_in: 3600 }));
    }
    if (u.endsWith("/me")) return new Response(JSON.stringify({ mail: null, userPrincipalName: "Person@Live.com" }));
    return new Response("{}");
  }) as typeof fetch;

  it("links a live.com account: state checked, tokens encrypted at rest", async () => {
    const vault = new TokenVault(pool, key, fakeProvider());
    const { pending } = startConnect("microsoft", "http://x/cb");
    const base = { accountId, provider: "microsoft" as const, redirectUri: "http://x/cb", code: "c" };
    await expect(completeConnect(vault, { ...base, returnedState: "forged", pending }, fakeProvider())).rejects.toThrow(/state/);
    await expect(completeConnect(vault, { ...base, returnedState: pending.state, pending: undefined }, fakeProvider())).rejects.toThrow(/state/);
    const r = await completeConnect(vault, { ...base, returnedState: pending.state, pending }, fakeProvider());
    expect(r.email).toBe("person@live.com");
    const raw = (await pool.query("SELECT token_cipher FROM integrations WHERE id=$1", [r.integrationId])).rows[0].token_cipher as Buffer;
    expect(raw.toString("utf8")).not.toContain("R1");
    expect(raw.toString("utf8")).not.toContain("A1");
    expect((await vault.list(accountId)).map((x) => x.externalId)).toContain("person@live.com");
  });

  it("refreshes an expired token, persists the rotated refresh token, and isolates accounts", async () => {
    let now = 0;
    const vault = new TokenVault(pool, key, fakeProvider(), () => now);
    const id = await vault.save(accountId, "microsoft", "r@live.com", ["Mail.ReadWrite"], { accessToken: "OLD", refreshToken: "R1", expiresAt: 100_000 });
    expect(await vault.getAccessToken(accountId, id)).toBe("OLD");
    now = 200_000;
    expect(await vault.getAccessToken(accountId, id)).toBe("A2");
    expect(await vault.getAccessToken(accountId, id)).toBe("A2"); // cached, no second refresh
    const other = (await pool.query("INSERT INTO accounts(email) VALUES ($1) RETURNING id", [`x${Date.now()}@example.com`])).rows[0].id;
    await expect(vault.getAccessToken(other, id)).rejects.toThrow();
    await pool.query("DELETE FROM accounts WHERE id=$1", [other]);
  });

  it("disconnect revokes at Google, wipes tokens and blocks further use", async () => {
    const calls: string[] = [];
    const vault = new TokenVault(pool, key, fakeProvider(calls));
    const id = await vault.save(accountId, "google", "g@gmail.com", ["x"], { accessToken: "A", refreshToken: "RG", expiresAt: Date.now() + 3600_000 });
    await vault.disconnect(accountId, id);
    expect(calls.some((c) => c.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect((await pool.query("SELECT length(token_cipher) AS n, status FROM integrations WHERE id=$1", [id])).rows[0]).toMatchObject({ n: 0, status: "revoked" });
    await expect(vault.getAccessToken(accountId, id)).rejects.toThrow(/not connected/);
  });
});
