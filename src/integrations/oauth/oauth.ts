import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ProviderConfig } from "./providers";

export interface TokenSet { accessToken: string; refreshToken?: string; expiresAt: number }
type Fetch = typeof fetch;

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(16).toString("base64url") };
}

export function buildAuthUrl(cfg: ProviderConfig, o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const u = new URL(cfg.authUrl);
  const params: Record<string, string> = {
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code",
    scope: cfg.scopes.join(" "), state: o.state,
    code_challenge: o.challenge, code_challenge_method: "S256", ...cfg.extraAuthParams,
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function tokenRequest(cfg: ProviderConfig, body: Record<string, string>, f: Fetch, now: number): Promise<TokenSet> {
  const res = await f(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j.access_token) throw new OAuthError(j.error ?? `HTTP ${res.status}`, j.error_description);
  return { accessToken: j.access_token, ...(j.refresh_token ? { refreshToken: j.refresh_token } : {}), expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
}

export class OAuthError extends Error {
  constructor(public code: string, detail?: string) { super(`oauth ${code}${detail ? `: ${detail}` : ""}`); }
}

export const exchangeCode = (cfg: ProviderConfig, c: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }, f: Fetch = fetch, now = Date.now()) =>
  tokenRequest(cfg, { grant_type: "authorization_code", code: c.code, redirect_uri: c.redirectUri, client_id: c.clientId, client_secret: c.clientSecret, code_verifier: c.verifier }, f, now);

export const refreshTokens = (cfg: ProviderConfig, c: { clientId: string; clientSecret: string; refreshToken: string }, f: Fetch = fetch, now = Date.now()) =>
  tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, scope: cfg.scopes.join(" ") }, f, now);

/** Which mailbox did the user just connect? Google: userinfo.email. Microsoft: Graph /me. */
export async function fetchIdentity(cfg: ProviderConfig, accessToken: string, f: Fetch = fetch): Promise<string> {
  const res = await f(cfg.identityUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`identity lookup failed: HTTP ${res.status}`);
  const j = (await res.json()) as any;
  const email = (cfg.id === "google" ? j.email : j.mail ?? j.userPrincipalName) as string | undefined;
  if (!email) throw new Error("provider returned no email address");
  return email.toLowerCase();
}
